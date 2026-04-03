import { Request, Response } from "express";
import { ItemType, Prisma } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { getQueryNumber, getQueryString } from "../utils/request";
import { buildBranchFilter } from "../utils/branchFilter";
import { prisma } from "../lib/prisma";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

export const getAllReportInvoices = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pageSize = getQueryNumber(req.query.pageSize, 10)!;
    const pageNumber = getQueryNumber(req.query.page, 1)!;
    const offset = (pageNumber - 1) * pageSize;

    const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
    const sortField = getQueryString(req.query.sortField, "createdAt")!;
    const sortOrderText =
      getQueryString(req.query.sortOrder, "desc")!.toLowerCase() === "asc"
        ? "asc"
        : "desc";

    const startDate = getQueryString(req.query.startDate, "") || undefined;
    const endDate = getQueryString(req.query.endDate, "") || undefined;
    const saleType = getQueryString(req.query.saleType, "") || undefined;
    const status = getQueryString(req.query.status, "") || undefined;
    const branchId = req.query.branchId
      ? parseInt(req.query.branchId as string, 10)
      : undefined;

    const loggedInUser = req.user;
    if (!loggedInUser) {
      res.status(401).json({ message: "User is not authenticated." });
      return;
    }

    const allowedStatuses = ["PENDING", "APPROVED", "COMPLETED", "CANCELLED"];
    const safeStatus =
      status && allowedStatuses.includes(status) ? status : undefined;

    const allowedSaleTypes = ["RETAIL", "WHOLESALE"];
    const safeSaleType =
      saleType && saleType !== "ALL" && allowedSaleTypes.includes(saleType)
        ? saleType
        : undefined;

    const sortFieldMap: Record<string, Prisma.Sql> = {
      id: Prisma.sql`rd."id"`,
      ref: Prisma.sql`rd."ref"`,
      orderDate: Prisma.sql`rd."orderDate"`,
      OrderSaleType: Prisma.sql`rd."OrderSaleType"`,
      customerId: Prisma.sql`cs."name"`,
      branchId: Prisma.sql`br."name"`,
      status: Prisma.sql`rd."status"`,
      totalAmount: Prisma.sql`rd."totalAmount"`,
      paidAmount: Prisma.sql`rd."paidAmount"`,
      due: Prisma.sql`(COALESCE(rd."totalAmount", 0) - COALESCE(rd."paidAmount", 0))`,
      approvedAt: Prisma.sql`rd."approvedAt"`,
      approvedBy: Prisma.sql`ab."firstName"`,
      createdAt: Prisma.sql`rd."createdAt"`,
      createdBy: Prisma.sql`c."firstName"`,
      updatedAt: Prisma.sql`rd."updatedAt"`,
      updatedBy: Prisma.sql`u."firstName"`,
      orderProfit: Prisma.sql`COALESCE(pf."orderProfit", 0)`,
    };

    const orderByField = sortFieldMap[sortField] || Prisma.sql`rd."createdAt"`;
    const orderByDirection =
      sortOrderText === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const conditions: Prisma.Sql[] = [];

    conditions.push(Prisma.sql`rd."deletedAt" IS NULL`);

    if (loggedInUser.roleType === "ADMIN") {
      if (branchId) {
        conditions.push(Prisma.sql`rd."branchId" = ${branchId}`);
      }
    } else {
      if (!loggedInUser.branchId) {
        res.status(403).json({ message: "Branch not assigned." });
        return;
      }

      conditions.push(Prisma.sql`rd."branchId" = ${loggedInUser.branchId}`);
      conditions.push(Prisma.sql`rd."createdBy" = ${loggedInUser.id}`);
    }

    if (startDate && endDate) {
      conditions.push(
        Prisma.sql`rd."orderDate"::date BETWEEN ${startDate}::date AND ${endDate}::date`
      );
    } else if (startDate) {
      conditions.push(Prisma.sql`rd."orderDate"::date >= ${startDate}::date`);
    } else if (endDate) {
      conditions.push(Prisma.sql`rd."orderDate"::date <= ${endDate}::date`);
    }

    if (safeSaleType) {
      conditions.push(
        Prisma.sql`rd."OrderSaleType" = ${safeSaleType}::"QuoteSaleType"`
      );
    }

    if (safeStatus) {
      conditions.push(
        Prisma.sql`rd."status" = ${safeStatus}::"OrderStatus"`
      );
    } else {
      conditions.push(
        Prisma.sql`rd."status" IN ('APPROVED'::"OrderStatus", 'COMPLETED'::"OrderStatus")`
      );
    }

    if (searchTerm) {
      const searchWords = searchTerm.split(/\s+/).filter(Boolean);

      const searchConditions = searchWords.map((word) => {
        const likeWord = `%${word}%`;

        return Prisma.sql`
          (
            rd."ref" ILIKE ${likeWord}
            OR cs."name" ILIKE ${likeWord}
            OR br."name" ILIKE ${likeWord}
            OR c."firstName" ILIKE ${likeWord}
            OR c."lastName" ILIKE ${likeWord}
            OR u."firstName" ILIKE ${likeWord}
            OR u."lastName" ILIKE ${likeWord}
            OR ab."firstName" ILIKE ${likeWord}
            OR ab."lastName" ILIKE ${likeWord}
            OR TO_CHAR(rd."orderDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(rd."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(rd."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(rd."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
          )
        `;
      });

      conditions.push(
        Prisma.sql`(${Prisma.join(searchConditions, " AND ")})`
      );
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;
    
    /**
     * Profit logic:
     *
     * Sales profit:
     *   SUM(OrderItem.total - OrderItem.cogs)
     *
     * Return profit reversal:
     *   SUM(SaleReturnItems.total - proportional returned cost)
     *
     * Net order profit:
     *   salesProfit - returnProfit
     *
     * proportional returned cost:
     *   if baseQty exists -> (oi.cogs / oi.baseQty) * sri.baseQty
     *   else if quantity exists -> (oi.cogs / oi.quantity) * sri.quantity
     *   else 0
     */

    const summaryResult = await prisma.$queryRaw<
      {
        totalInvoice: bigint;
        totalAmount: Prisma.Decimal | number;
        totalReceivedAmount: Prisma.Decimal | number;
        totalRemainAmount: Prisma.Decimal | number;
        totalProfit: Prisma.Decimal | number;
      }[]
    >`
      WITH filtered_orders AS (
        SELECT
          rd."id",
          rd."totalAmount",
          rd."paidAmount"
        FROM "Order" rd
        LEFT JOIN "Customer" cs ON rd."customerId" = cs."id"
        LEFT JOIN "Branch" br ON rd."branchId" = br."id"
        LEFT JOIN "User" c ON rd."createdBy" = c."id"
        LEFT JOIN "User" u ON rd."updatedBy" = u."id"
        LEFT JOIN "User" ab ON rd."approvedBy" = ab."id"
        ${whereClause}
      ),
      sales_profit AS (
        SELECT
          oi."orderId",
          COALESCE(SUM(COALESCE(oi."total", 0) - COALESCE(oi."cogs", 0)), 0) AS "salesProfit"
        FROM "OrderItem" oi
        GROUP BY oi."orderId"
      ),
      return_profit AS (
        SELECT
          sr."orderId",
          COALESCE(
            SUM(
              COALESCE(sri."total", 0) -
              CASE
                WHEN COALESCE(oi."baseQty", 0) > 0 AND COALESCE(sri."baseQty", 0) > 0
                  THEN (COALESCE(oi."cogs", 0) / NULLIF(oi."baseQty", 0)) * COALESCE(sri."baseQty", 0)
                WHEN COALESCE(oi."quantity", 0) > 0 AND COALESCE(sri."quantity", 0) > 0
                  THEN (COALESCE(oi."cogs", 0) / NULLIF(oi."quantity", 0)) * COALESCE(sri."quantity", 0)
                ELSE 0
              END
            ),
            0
          ) AS "returnProfit"
        FROM "SaleReturns" sr
        JOIN "SaleReturnItems" sri
          ON sri."saleReturnId" = sr."id"
        LEFT JOIN "OrderItem" oi
          ON oi."id" = sri."saleItemId"
        WHERE sr."deletedAt" IS NULL
          AND sr."status" = 'APPROVED'::"StatusType"
        GROUP BY sr."orderId"
      ),
      final_profit AS (
        SELECT
          fo."id" AS "orderId",
          COALESCE(sp."salesProfit", 0) - COALESCE(rp."returnProfit", 0) AS "orderProfit"
        FROM filtered_orders fo
        LEFT JOIN sales_profit sp ON sp."orderId" = fo."id"
        LEFT JOIN return_profit rp ON rp."orderId" = fo."id"
      )
      SELECT
        COUNT(fo."id") AS "totalInvoice",
        COALESCE(SUM(fo."totalAmount"), 0) AS "totalAmount",
        COALESCE(SUM(fo."paidAmount"), 0) AS "totalReceivedAmount",
        COALESCE(SUM(COALESCE(fo."totalAmount", 0) - COALESCE(fo."paidAmount", 0)), 0) AS "totalRemainAmount",
        COALESCE(SUM(fp."orderProfit"), 0) AS "totalProfit"
      FROM filtered_orders fo
      LEFT JOIN final_profit fp ON fp."orderId" = fo."id"
    `;

    const totalResult = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM (
        SELECT rd."id"
        FROM "Order" rd
        LEFT JOIN "Customer" cs ON rd."customerId" = cs."id"
        LEFT JOIN "Branch" br ON rd."branchId" = br."id"
        LEFT JOIN "User" c ON rd."createdBy" = c."id"
        LEFT JOIN "User" u ON rd."updatedBy" = u."id"
        LEFT JOIN "User" ab ON rd."approvedBy" = ab."id"
        ${whereClause}
      ) AS t
    `;

    const invoices = await prisma.$queryRaw<any[]>`
      WITH sales_profit AS (
        SELECT
          oi."orderId",
          COALESCE(SUM(COALESCE(oi."total", 0) - COALESCE(oi."cogs", 0)), 0) AS "salesProfit"
        FROM "OrderItem" oi
        GROUP BY oi."orderId"
      ),
      return_profit AS (
        SELECT
          sr."orderId",
          COALESCE(
            SUM(
              COALESCE(sri."total", 0) -
              CASE
                WHEN COALESCE(oi."baseQty", 0) > 0 AND COALESCE(sri."baseQty", 0) > 0
                  THEN (COALESCE(oi."cogs", 0) / NULLIF(oi."baseQty", 0)) * COALESCE(sri."baseQty", 0)
                WHEN COALESCE(oi."quantity", 0) > 0 AND COALESCE(sri."quantity", 0) > 0
                  THEN (COALESCE(oi."cogs", 0) / NULLIF(oi."quantity", 0)) * COALESCE(sri."quantity", 0)
                ELSE 0
              END
            ),
            0
          ) AS "returnProfit"
        FROM "SaleReturns" sr
        JOIN "SaleReturnItems" sri
          ON sri."saleReturnId" = sr."id"
        LEFT JOIN "OrderItem" oi
          ON oi."id" = sri."saleItemId"
        WHERE sr."deletedAt" IS NULL
          AND sr."status" = 'APPROVED'::"StatusType"
        GROUP BY sr."orderId"
      ),
      pf AS (
        SELECT
          o."id" AS "orderId",
          COALESCE(sp."salesProfit", 0) - COALESCE(rp."returnProfit", 0) AS "orderProfit"
        FROM "Order" o
        LEFT JOIN sales_profit sp ON sp."orderId" = o."id"
        LEFT JOIN return_profit rp ON rp."orderId" = o."id"
      )
      SELECT
        rd.*,
        COALESCE(pf."orderProfit", 0) AS "orderProfit",
        (COALESCE(rd."totalAmount", 0) - COALESCE(rd."paidAmount", 0)) AS "dueAmount",
        json_build_object('id', cs."id", 'name', cs."name") AS customer,
        json_build_object('id', br."id", 'name', br."name") AS branch,
        json_build_object('id', c."id", 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
        json_build_object('id', u."id", 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
        json_build_object('id', ab."id", 'firstName', ab."firstName", 'lastName', ab."lastName") AS approver,
        json_build_object('id', db."id", 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
      FROM "Order" rd
      LEFT JOIN "Customer" cs ON rd."customerId" = cs."id"
      LEFT JOIN "Branch" br ON rd."branchId" = br."id"
      LEFT JOIN "User" c ON rd."createdBy" = c."id"
      LEFT JOIN "User" u ON rd."updatedBy" = u."id"
      LEFT JOIN "User" ab ON rd."approvedBy" = ab."id"
      LEFT JOIN "User" db ON rd."deletedBy" = db."id"
      LEFT JOIN pf ON pf."orderId" = rd."id"
      ${whereClause}
      ORDER BY ${orderByField} ${orderByDirection}
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const summarySafe = {
      totalInvoice: Number(summaryResult?.[0]?.totalInvoice || 0),
      totalAmount: Number(summaryResult?.[0]?.totalAmount || 0),
      totalReceivedAmount: Number(summaryResult?.[0]?.totalReceivedAmount || 0),
      totalRemainAmount: Number(summaryResult?.[0]?.totalRemainAmount || 0),
      totalProfit: Number(summaryResult?.[0]?.totalProfit || 0),
    };

    const invoicesSafe = invoices.map((inv) => ({
      ...inv,
      id: Number(inv.id),
      branchId: Number(inv.branchId),
      customerId: inv.customerId ? Number(inv.customerId) : null,
      createdBy: inv.createdBy ? Number(inv.createdBy) : null,
      updatedBy: inv.updatedBy ? Number(inv.updatedBy) : null,
      approvedBy: inv.approvedBy ? Number(inv.approvedBy) : null,
      deletedBy: inv.deletedBy ? Number(inv.deletedBy) : null,
      totalAmount: Number(inv.totalAmount || 0),
      paidAmount: Number(inv.paidAmount || 0),
      dueAmount: Number(inv.dueAmount || 0),
      orderProfit: Number(inv.orderProfit || 0),
      grandTotal: Number(inv.totalAmount || 0),
    }));

    res.status(200).json({
      data: invoicesSafe,
      total: Number(totalResult?.[0]?.total || 0),
      summary: summarySafe,
    });
  } catch (error) {
    console.error("Report invoice error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllCancelReportInvoices = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pageSize = getQueryNumber(req.query.pageSize, 10)!;
    const pageNumber = getQueryNumber(req.query.page, 1)!;
    const offset = (pageNumber - 1) * pageSize;

    const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
    const sortField = getQueryString(req.query.sortField, "deletedAt")!;
    const sortOrderText =
      getQueryString(req.query.sortOrder, "desc")!.toLowerCase() === "asc"
        ? "asc"
        : "desc";

    const startDate = getQueryString(req.query.startDate, "") || undefined;
    const endDate = getQueryString(req.query.endDate, "") || undefined;
    const saleType = getQueryString(req.query.saleType, "") || undefined;
    const branchId = req.query.branchId
      ? parseInt(req.query.branchId as string, 10)
      : undefined;

    const loggedInUser = req.user;
    if (!loggedInUser) {
      res.status(401).json({ message: "User is not authenticated." });
      return;
    }

    const allowedSaleTypes = ["RETAIL", "WHOLESALE"];
    const safeSaleType =
      saleType && saleType !== "ALL" && allowedSaleTypes.includes(saleType)
        ? saleType
        : undefined;

    const sortFieldMap: Record<string, Prisma.Sql> = {
      id: Prisma.sql`rd."id"`,
      ref: Prisma.sql`rd."ref"`,
      orderDate: Prisma.sql`rd."orderDate"`,
      OrderSaleType: Prisma.sql`rd."OrderSaleType"`,
      customerId: Prisma.sql`cs."name"`,
      branchId: Prisma.sql`br."name"`,
      status: Prisma.sql`rd."status"`,
      totalAmount: Prisma.sql`rd."totalAmount"`,
      paidAmount: Prisma.sql`rd."paidAmount"`,
      due: Prisma.sql`(COALESCE(rd."totalAmount", 0) - COALESCE(rd."paidAmount", 0))`,
      deletedAt: Prisma.sql`rd."deletedAt"`,
      deletedBy: Prisma.sql`db."firstName"`,
      delReason: Prisma.sql`rd."delReason"`,
      createdAt: Prisma.sql`rd."createdAt"`,
      createdBy: Prisma.sql`c."firstName"`,
      updatedAt: Prisma.sql`rd."updatedAt"`,
      updatedBy: Prisma.sql`u."firstName"`,
      lostProfit: Prisma.sql`COALESCE(pf."lostProfit", 0)`,
    };

    const orderByField = sortFieldMap[sortField] || Prisma.sql`rd."deletedAt"`;
    const orderByDirection =
      sortOrderText === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const conditions: Prisma.Sql[] = [];

    conditions.push(Prisma.sql`rd."status" = 'CANCELLED'::"OrderStatus"`);

    if (loggedInUser.roleType === "ADMIN") {
      if (branchId) {
        conditions.push(Prisma.sql`rd."branchId" = ${branchId}`);
      }
    } else {
      if (!loggedInUser.branchId) {
        res.status(403).json({ message: "Branch not assigned." });
        return;
      }
      conditions.push(Prisma.sql`rd."branchId" = ${loggedInUser.branchId}`);
    }

    if (startDate && endDate) {
      conditions.push(
        Prisma.sql`rd."deletedAt"::date BETWEEN ${startDate}::date AND ${endDate}::date`
      );
    } else if (startDate) {
      conditions.push(Prisma.sql`rd."deletedAt"::date >= ${startDate}::date`);
    } else if (endDate) {
      conditions.push(Prisma.sql`rd."deletedAt"::date <= ${endDate}::date`);
    }

    if (safeSaleType) {
      conditions.push(
        Prisma.sql`rd."OrderSaleType" = ${safeSaleType}::"QuoteSaleType"`
      );
    }

    if (searchTerm) {
      const searchWords = searchTerm.split(/\s+/).filter(Boolean);

      const searchConditions = searchWords.map((word) => {
        const likeWord = `%${word}%`;

        return Prisma.sql`
          (
            rd."ref" ILIKE ${likeWord}
            OR cs."name" ILIKE ${likeWord}
            OR br."name" ILIKE ${likeWord}
            OR rd."delReason" ILIKE ${likeWord}
            OR c."firstName" ILIKE ${likeWord}
            OR c."lastName" ILIKE ${likeWord}
            OR u."firstName" ILIKE ${likeWord}
            OR u."lastName" ILIKE ${likeWord}
            OR db."firstName" ILIKE ${likeWord}
            OR db."lastName" ILIKE ${likeWord}
            OR TO_CHAR(rd."orderDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(rd."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(rd."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(rd."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(rd."orderDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(rd."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(rd."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(rd."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
          )
        `;
      });

      conditions.push(
        Prisma.sql`(${Prisma.join(searchConditions, " AND ")})`
      );
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    const summaryResult = await prisma.$queryRaw<
      {
        totalInvoice: bigint;
        totalAmount: Prisma.Decimal | number;
        totalReceivedAmount: Prisma.Decimal | number;
        totalRemainAmount: Prisma.Decimal | number;
        totalLostProfit: Prisma.Decimal | number;
      }[]
    >`
      WITH filtered_orders AS (
        SELECT
          rd."id",
          rd."totalAmount",
          rd."paidAmount"
        FROM "Order" rd
        LEFT JOIN "Customer" cs ON rd."customerId" = cs."id"
        LEFT JOIN "Branch" br ON rd."branchId" = br."id"
        LEFT JOIN "User" c ON rd."createdBy" = c."id"
        LEFT JOIN "User" u ON rd."updatedBy" = u."id"
        LEFT JOIN "User" db ON rd."deletedBy" = db."id"
        ${whereClause}
      ),
      pf AS (
        SELECT
          oi."orderId",
          COALESCE(SUM(COALESCE(oi."total", 0) - COALESCE(oi."cogs", 0)), 0) AS "lostProfit"
        FROM "OrderItem" oi
        GROUP BY oi."orderId"
      )
      SELECT
        COUNT(fo."id") AS "totalInvoice",
        COALESCE(SUM(fo."totalAmount"), 0) AS "totalAmount",
        COALESCE(SUM(fo."paidAmount"), 0) AS "totalReceivedAmount",
        COALESCE(SUM(COALESCE(fo."totalAmount", 0) - COALESCE(fo."paidAmount", 0)), 0) AS "totalRemainAmount",
        COALESCE(SUM(pf."lostProfit"), 0) AS "totalLostProfit"
      FROM filtered_orders fo
      LEFT JOIN pf ON pf."orderId" = fo."id"
    `;

    const totalResult = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM (
        SELECT rd."id"
        FROM "Order" rd
        LEFT JOIN "Customer" cs ON rd."customerId" = cs."id"
        LEFT JOIN "Branch" br ON rd."branchId" = br."id"
        LEFT JOIN "User" c ON rd."createdBy" = c."id"
        LEFT JOIN "User" u ON rd."updatedBy" = u."id"
        LEFT JOIN "User" db ON rd."deletedBy" = db."id"
        ${whereClause}
      ) AS t
    `;

    const invoices = await prisma.$queryRaw<any[]>`
      WITH pf AS (
        SELECT
          oi."orderId",
          COALESCE(SUM(COALESCE(oi."total", 0) - COALESCE(oi."cogs", 0)), 0) AS "lostProfit"
        FROM "OrderItem" oi
        GROUP BY oi."orderId"
      )
      SELECT
        rd.*,
        COALESCE(pf."lostProfit", 0) AS "lostProfit",
        (COALESCE(rd."totalAmount", 0) - COALESCE(rd."paidAmount", 0)) AS "dueAmount",
        json_build_object('id', cs."id", 'name', cs."name") AS customer,
        json_build_object('id', br."id", 'name', br."name") AS branch,
        json_build_object('id', c."id", 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
        json_build_object('id', u."id", 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
        json_build_object('id', ab."id", 'firstName', ab."firstName", 'lastName', ab."lastName") AS approver,
        json_build_object('id', db."id", 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
      FROM "Order" rd
      LEFT JOIN "Customer" cs ON rd."customerId" = cs."id"
      LEFT JOIN "Branch" br ON rd."branchId" = br."id"
      LEFT JOIN "User" c ON rd."createdBy" = c."id"
      LEFT JOIN "User" u ON rd."updatedBy" = u."id"
      LEFT JOIN "User" ab ON rd."approvedBy" = ab."id"
      LEFT JOIN "User" db ON rd."deletedBy" = db."id"
      LEFT JOIN pf ON pf."orderId" = rd."id"
      ${whereClause}
      ORDER BY ${orderByField} ${orderByDirection}
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const summarySafe = {
      totalInvoice: Number(summaryResult?.[0]?.totalInvoice || 0),
      totalAmount: Number(summaryResult?.[0]?.totalAmount || 0),
      totalReceivedAmount: Number(summaryResult?.[0]?.totalReceivedAmount || 0),
      totalRemainAmount: Number(summaryResult?.[0]?.totalRemainAmount || 0),
      totalLostProfit: Number(summaryResult?.[0]?.totalLostProfit || 0),
    };

    const invoicesSafe = invoices.map((inv) => ({
      ...inv,
      id: Number(inv.id),
      branchId: Number(inv.branchId),
      customerId: inv.customerId ? Number(inv.customerId) : null,
      createdBy: inv.createdBy ? Number(inv.createdBy) : null,
      updatedBy: inv.updatedBy ? Number(inv.updatedBy) : null,
      approvedBy: inv.approvedBy ? Number(inv.approvedBy) : null,
      deletedBy: inv.deletedBy ? Number(inv.deletedBy) : null,
      totalAmount: Number(inv.totalAmount || 0),
      paidAmount: Number(inv.paidAmount || 0),
      dueAmount: Number(inv.dueAmount || 0),
      lostProfit: Number(inv.lostProfit || 0),
      grandTotal: Number(inv.totalAmount || 0),
    }));

    res.status(200).json({
      data: invoicesSafe,
      total: Number(totalResult?.[0]?.total || 0),
      summary: summarySafe,
    });
  } catch (error) {
    console.error("Report cancel invoice error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllPaymentInvoices = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pageSize = getQueryNumber(req.query.pageSize, 10)!;
    const pageNumber = getQueryNumber(req.query.page, 1)!;
    const offset = (pageNumber - 1) * pageSize;

    const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
    const sortField = getQueryString(req.query.sortField, "paymentDate")!;
    const sortOrderText =
      getQueryString(req.query.sortOrder, "desc")!.toLowerCase() === "asc"
        ? "asc"
        : "desc";

    const startDate = getQueryString(req.query.startDate, "") || undefined;
    const endDate = getQueryString(req.query.endDate, "") || undefined;
    const saleType = getQueryString(req.query.saleType, "") || undefined;
    const status = getQueryString(req.query.status, "") || undefined;
    const branchId = req.query.branchId
      ? parseInt(req.query.branchId as string, 10)
      : undefined;

    const loggedInUser = req.user;
    if (!loggedInUser) {
      res.status(401).json({ message: "User is not authenticated." });
      return;
    }

    const allowedSaleTypes = ["RETAIL", "WHOLESALE"];
    const safeSaleType =
      saleType && saleType !== "ALL" && allowedSaleTypes.includes(saleType)
        ? saleType
        : undefined;

    const allowedStatuses = ["PAID", "CANCELLED", "REFUND"];
    const safeStatus =
      status && allowedStatuses.includes(status) ? status : undefined;

    const sortFieldMap: Record<string, Prisma.Sql> = {
      id: Prisma.sql`op."id"`,
      paymentDate: Prisma.sql`op."paymentDate"`,
      ref: Prisma.sql`o."ref"`,
      customerId: Prisma.sql`cs."name"`,
      branchId: Prisma.sql`br."name"`,
      paymentMethodId: Prisma.sql`pm."name"`,
      totalPaid: Prisma.sql`op."totalPaid"`,
      receive_usd: Prisma.sql`op."receive_usd"`,
      receive_khr: Prisma.sql`op."receive_khr"`,
      exchangerate: Prisma.sql`op."exchangerate"`,
      status: Prisma.sql`op."status"`,
      createdAt: Prisma.sql`op."createdAt"`,
      createdBy: Prisma.sql`c."firstName"`,
      deletedAt: Prisma.sql`op."deletedAt"`,
      deletedBy: Prisma.sql`db."firstName"`,
      delReason: Prisma.sql`op."delReason"`,
    };

    const orderByField = sortFieldMap[sortField] || Prisma.sql`op."paymentDate"`;
    const orderByDirection =
      sortOrderText === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const conditions: Prisma.Sql[] = [];

    if (loggedInUser.roleType === "ADMIN") {
      if (branchId) {
        conditions.push(Prisma.sql`o."branchId" = ${branchId}`);
      }
    } else {
      if (!loggedInUser.branchId) {
        res.status(403).json({ message: "Branch not assigned." });
        return;
      }
      conditions.push(Prisma.sql`o."branchId" = ${loggedInUser.branchId}`);
    }

    if (safeSaleType) {
      conditions.push(
        Prisma.sql`o."OrderSaleType" = ${safeSaleType}::"QuoteSaleType"`
      );
    }

    if (safeStatus) {
      conditions.push(Prisma.sql`op."status" = ${safeStatus}`);
    }

    if (startDate && endDate) {
      conditions.push(
        Prisma.sql`op."paymentDate"::date BETWEEN ${startDate}::date AND ${endDate}::date`
      );
    } else if (startDate) {
      conditions.push(Prisma.sql`op."paymentDate"::date >= ${startDate}::date`);
    } else if (endDate) {
      conditions.push(Prisma.sql`op."paymentDate"::date <= ${endDate}::date`);
    } else {
      conditions.push(Prisma.sql`op."paymentDate"::date = CURRENT_DATE`);
    }

    if (searchTerm) {
      const searchWords = searchTerm.split(/\s+/).filter(Boolean);

      const searchConditions = searchWords.map((word) => {
        const likeWord = `%${word}%`;

        return Prisma.sql`
          (
            o."ref" ILIKE ${likeWord}
            OR cs."name" ILIKE ${likeWord}
            OR br."name" ILIKE ${likeWord}
            OR pm."name" ILIKE ${likeWord}
            OR c."firstName" ILIKE ${likeWord}
            OR c."lastName" ILIKE ${likeWord}
            OR db."firstName" ILIKE ${likeWord}
            OR db."lastName" ILIKE ${likeWord}
            OR TO_CHAR(op."paymentDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(op."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(op."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(op."paymentDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(op."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(op."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
          )
        `;
      });

      conditions.push(
        Prisma.sql`(${Prisma.join(searchConditions, " AND ")})`
      );
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    const summaryResult = await prisma.$queryRaw<
      { totalPayments: bigint; totalPaid: Prisma.Decimal | number }[]
    >`
      SELECT
        COUNT(op."id") AS "totalPayments",
        COALESCE(SUM(op."totalPaid"), 0) AS "totalPaid"
      FROM "OrderOnPayments" op
      LEFT JOIN "Order" o ON op."orderId" = o."id"
      LEFT JOIN "Customer" cs ON o."customerId" = cs."id"
      LEFT JOIN "Branch" br ON o."branchId" = br."id"
      LEFT JOIN "PaymentMethods" pm ON op."paymentMethodId" = pm."id"
      LEFT JOIN "User" c ON op."createdBy" = c."id"
      LEFT JOIN "User" db ON op."deletedBy" = db."id"
      ${whereClause}
    `;

    const totalResult = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM "OrderOnPayments" op
      LEFT JOIN "Order" o ON op."orderId" = o."id"
      LEFT JOIN "Customer" cs ON o."customerId" = cs."id"
      LEFT JOIN "Branch" br ON o."branchId" = br."id"
      LEFT JOIN "PaymentMethods" pm ON op."paymentMethodId" = pm."id"
      LEFT JOIN "User" c ON op."createdBy" = c."id"
      LEFT JOIN "User" db ON op."deletedBy" = db."id"
      ${whereClause}
    `;

    const payments = await prisma.$queryRaw<any[]>`
      SELECT
        op.*,
        json_build_object(
          'id', o."id",
          'ref', o."ref",
          'customerId', o."customerId",
          'orderDate', o."orderDate",
          'OrderSaleType', o."OrderSaleType",
          'status', o."status",
          'totalAmount', o."totalAmount",
          'paidAmount', o."paidAmount"
        ) AS "order",
        json_build_object(
          'id', pm."id",
          'name', pm."name"
        ) AS "PaymentMethods",
        json_build_object('id', cs."id", 'name', cs."name") AS customer,
        json_build_object('id', br."id", 'name', br."name") AS branch,
        json_build_object('id', c."id", 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
        json_build_object('id', db."id", 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
      FROM "OrderOnPayments" op
      LEFT JOIN "Order" o ON op."orderId" = o."id"
      LEFT JOIN "Customer" cs ON o."customerId" = cs."id"
      LEFT JOIN "PaymentMethods" pm ON op."paymentMethodId" = pm."id"
      LEFT JOIN "Branch" br ON o."branchId" = br."id"
      LEFT JOIN "User" c ON op."createdBy" = c."id"
      LEFT JOIN "User" db ON op."deletedBy" = db."id"
      ${whereClause}
      ORDER BY ${orderByField} ${orderByDirection}
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const summary = {
      totalPayments: Number(summaryResult?.[0]?.totalPayments || 0),
      totalPaid: Number(summaryResult?.[0]?.totalPaid || 0),
    };

    const paymentsSafe = payments.map((p: any) => ({
      ...p,
      id: Number(p.id),
      orderId: Number(p.orderId),
      totalPaid: Number(p.totalPaid || 0),
      receive_usd: Number(p.receive_usd || 0),
      receive_khr: Number(p.receive_khr || 0),
      exchangerate: Number(p.exchangerate || 0),
      paymentMethodId: p.paymentMethodId ? Number(p.paymentMethodId) : null,
      createdBy: p.createdBy ? Number(p.createdBy) : null,
      updatedBy: p.updatedBy ? Number(p.updatedBy) : null,
      deletedBy: p.deletedBy ? Number(p.deletedBy) : null,
    }));

    res.status(200).json({
      data: paymentsSafe,
      total: Number(totalResult?.[0]?.total || 0),
      summary,
    });
  } catch (error) {
    console.error("Payment invoice report error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllReportQuotations = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pageSize = getQueryNumber(req.query.pageSize, 10)!;
    const pageNumber = getQueryNumber(req.query.page, 1)!;
    const offset = (pageNumber - 1) * pageSize;

    const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
    const sortField = getQueryString(req.query.sortField, "quotationDate")!;
    const sortOrderText =
      getQueryString(req.query.sortOrder, "desc")!.toLowerCase() === "asc"
        ? "asc"
        : "desc";

    const startDate = getQueryString(req.query.startDate, "") || undefined;
    const endDate = getQueryString(req.query.endDate, "") || undefined;
    const saleType = getQueryString(req.query.saleType, "") || undefined;
    const status = getQueryString(req.query.status, "") || undefined;
    const branchId = req.query.branchId
      ? parseInt(req.query.branchId as string, 10)
      : undefined;

    const loggedInUser = req.user;
    if (!loggedInUser) {
      res.status(401).json({ message: "User is not authenticated." });
      return;
    }

    const allowedSaleTypes = ["RETAIL", "WHOLESALE"];
    const safeSaleType =
      saleType && saleType !== "ALL" && allowedSaleTypes.includes(saleType)
        ? saleType
        : undefined;

    const allowedStatuses = ["PENDING", "SENT", "INVOICED", "CANCELLED"];
    const safeStatus =
      status && allowedStatuses.includes(status) ? status : undefined;

    const sortFieldMap: Record<string, Prisma.Sql> = {
      id: Prisma.sql`qt."id"`,
      quotationDate: Prisma.sql`qt."quotationDate"`,
      ref: Prisma.sql`qt."ref"`,
      QuoteSaleType: Prisma.sql`qt."QuoteSaleType"`,
      customerId: Prisma.sql`cs."name"`,
      branchId: Prisma.sql`br."name"`,
      status: Prisma.sql`qt."status"`,
      grandTotal: Prisma.sql`qt."grandTotal"`,
      sentAt: Prisma.sql`qt."sentAt"`,
      sentBy: Prisma.sql`sb."firstName"`,
      invoicedAt: Prisma.sql`qt."invoicedAt"`,
      invoicedBy: Prisma.sql`inb."firstName"`,
      createdAt: Prisma.sql`qt."createdAt"`,
      createdBy: Prisma.sql`c."firstName"`,
      updatedAt: Prisma.sql`qt."updatedAt"`,
      updatedBy: Prisma.sql`u."firstName"`,
      deletedAt: Prisma.sql`qt."deletedAt"`,
      deletedBy: Prisma.sql`db."firstName"`,
      delReason: Prisma.sql`qt."delReason"`,
    };

    const orderByField = sortFieldMap[sortField] || Prisma.sql`qt."quotationDate"`;
    const orderByDirection =
      sortOrderText === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const conditions: Prisma.Sql[] = [];

    if (loggedInUser.roleType === "ADMIN") {
      if (branchId) {
        conditions.push(Prisma.sql`qt."branchId" = ${branchId}`);
      }
    } else {
      if (!loggedInUser.branchId) {
        res.status(403).json({ message: "Branch not assigned." });
        return;
      }
      conditions.push(Prisma.sql`qt."branchId" = ${loggedInUser.branchId}`);
    }

    if (startDate && endDate) {
      conditions.push(
        Prisma.sql`qt."quotationDate"::date BETWEEN ${startDate}::date AND ${endDate}::date`
      );
    } else if (startDate) {
      conditions.push(Prisma.sql`qt."quotationDate"::date >= ${startDate}::date`);
    } else if (endDate) {
      conditions.push(Prisma.sql`qt."quotationDate"::date <= ${endDate}::date`);
    }

    if (safeSaleType) {
      conditions.push(
        Prisma.sql`qt."QuoteSaleType" = ${safeSaleType}::"QuoteSaleType"`
      );
    }

    if (safeStatus) {
      conditions.push(
        Prisma.sql`qt."status" = ${safeStatus}::"QuotationStatus"`
      );
    }

    if (searchTerm) {
      const searchWords = searchTerm.split(/\s+/).filter(Boolean);

      const searchConditions = searchWords.map((word) => {
        const likeWord = `%${word}%`;
        return Prisma.sql`
          (
            qt."ref" ILIKE ${likeWord}
            OR cs."name" ILIKE ${likeWord}
            OR br."name" ILIKE ${likeWord}
            OR c."firstName" ILIKE ${likeWord}
            OR c."lastName" ILIKE ${likeWord}
            OR u."firstName" ILIKE ${likeWord}
            OR u."lastName" ILIKE ${likeWord}
            OR sb."firstName" ILIKE ${likeWord}
            OR sb."lastName" ILIKE ${likeWord}
            OR inb."firstName" ILIKE ${likeWord}
            OR inb."lastName" ILIKE ${likeWord}
            OR db."firstName" ILIKE ${likeWord}
            OR db."lastName" ILIKE ${likeWord}
            OR TO_CHAR(qt."quotationDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(qt."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(qt."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(qt."invoicedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(qt."sentAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(qt."quotationDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(qt."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(qt."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(qt."invoicedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(qt."sentAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
          )
        `;
      });

      conditions.push(
        Prisma.sql`(${Prisma.join(searchConditions, " AND ")})`
      );
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    const summaryResult = await prisma.$queryRaw<
      { totalQuotation: bigint; totalAmount: Prisma.Decimal | number }[]
    >`
      SELECT
        COUNT(DISTINCT qt."id") AS "totalQuotation",
        COALESCE(SUM(qt."grandTotal"), 0) AS "totalAmount"
      FROM "Quotations" qt
      LEFT JOIN "Customer" cs ON qt."customerId" = cs."id"
      LEFT JOIN "Branch" br ON qt."branchId" = br."id"
      LEFT JOIN "User" c ON qt."createdBy" = c."id"
      LEFT JOIN "User" u ON qt."updatedBy" = u."id"
      LEFT JOIN "User" sb ON qt."sentBy" = sb."id"
      LEFT JOIN "User" inb ON qt."invoicedBy" = inb."id"
      LEFT JOIN "User" db ON qt."deletedBy" = db."id"
      ${whereClause}
    `;

    const totalResult = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM (
        SELECT qt."id"
        FROM "Quotations" qt
        LEFT JOIN "Customer" cs ON qt."customerId" = cs."id"
        LEFT JOIN "Branch" br ON qt."branchId" = br."id"
        LEFT JOIN "User" c ON qt."createdBy" = c."id"
        LEFT JOIN "User" u ON qt."updatedBy" = u."id"
        LEFT JOIN "User" sb ON qt."sentBy" = sb."id"
        LEFT JOIN "User" inb ON qt."invoicedBy" = inb."id"
        LEFT JOIN "User" db ON qt."deletedBy" = db."id"
        ${whereClause}
      ) AS t
    `;

    const quotations = await prisma.$queryRaw<any[]>`
      SELECT
        qt.*,
        json_build_object('id', cs."id", 'name', cs."name") AS customer,
        json_build_object('id', br."id", 'name', br."name") AS branch,
        json_build_object('id', c."id", 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
        json_build_object('id', u."id", 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
        json_build_object('id', sb."id", 'firstName', sb."firstName", 'lastName', sb."lastName") AS sender,
        json_build_object('id', inb."id", 'firstName', inb."firstName", 'lastName', inb."lastName") AS invoicer,
        json_build_object('id', db."id", 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
      FROM "Quotations" qt
      LEFT JOIN "Customer" cs ON qt."customerId" = cs."id"
      LEFT JOIN "Branch" br ON qt."branchId" = br."id"
      LEFT JOIN "User" c ON qt."createdBy" = c."id"
      LEFT JOIN "User" u ON qt."updatedBy" = u."id"
      LEFT JOIN "User" sb ON qt."sentBy" = sb."id"
      LEFT JOIN "User" inb ON qt."invoicedBy" = inb."id"
      LEFT JOIN "User" db ON qt."deletedBy" = db."id"
      ${whereClause}
      ORDER BY ${orderByField} ${orderByDirection}
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const summarySafe = {
      totalQuotation: Number(summaryResult?.[0]?.totalQuotation || 0),
      totalAmount: Number(summaryResult?.[0]?.totalAmount || 0),
    };

    const quotationsSafe = quotations.map((quote: any) => ({
      ...quote,
      id: Number(quote.id),
      branchId: Number(quote.branchId),
      customerId: quote.customerId ? Number(quote.customerId) : null,
      createdBy: quote.createdBy ? Number(quote.createdBy) : null,
      updatedBy: quote.updatedBy ? Number(quote.updatedBy) : null,
      invoicedBy: quote.invoicedBy ? Number(quote.invoicedBy) : null,
      sentBy: quote.sentBy ? Number(quote.sentBy) : null,
      deletedBy: quote.deletedBy ? Number(quote.deletedBy) : null,
      grandTotal: Number(quote.grandTotal || 0),
    }));

    res.status(200).json({
      data: quotationsSafe,
      total: Number(totalResult?.[0]?.total || 0),
      summary: summarySafe,
    });
  } catch (error) {
    console.error("Report quotation error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllReportPurchases = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pageSize = getQueryNumber(req.query.pageSize, 10)!;
    const pageNumber = getQueryNumber(req.query.page, 1)!;
    const offset = (pageNumber - 1) * pageSize;

    const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
    const sortField = getQueryString(req.query.sortField, "purchaseDate")!;
    const sortOrderText =
      getQueryString(req.query.sortOrder, "desc")!.toLowerCase() === "asc"
        ? "asc"
        : "desc";

    const startDate = getQueryString(req.query.startDate, "") || undefined;
    const endDate = getQueryString(req.query.endDate, "") || undefined;
    const status = getQueryString(req.query.status, "") || undefined;
    const branchId = req.query.branchId
      ? parseInt(req.query.branchId as string, 10)
      : undefined;

    const groupBy = getQueryString(req.query.groupBy, "day") || "day";

    const loggedInUser = req.user;
    if (!loggedInUser) {
      res.status(401).json({ message: "User is not authenticated." });
      return;
    }

    const allowedStatuses = [
      "PENDING",
      "REQUESTED",
      "APPROVED",
      "RECEIVED",
      "CANCELLED",
      "COMPLETED",
    ];
    const safeStatus =
      status && allowedStatuses.includes(status) ? status : undefined;

    const sortFieldMap: Record<string, Prisma.Sql> = {
      id: Prisma.sql`pc."id"`,
      purchaseDate: Prisma.sql`pc."purchaseDate"`,
      ref: Prisma.sql`pc."ref"`,
      supplierId: Prisma.sql`s."name"`,
      branchId: Prisma.sql`br."name"`,
      status: Prisma.sql`pc."status"`,
      grandTotal: Prisma.sql`pc."grandTotal"`,
      paidAmount: Prisma.sql`pc."paidAmount"`,
      due: Prisma.sql`(COALESCE(pc."grandTotal", 0) - COALESCE(pc."paidAmount", 0))`,
      receivedAt: Prisma.sql`pc."receivedAt"`,
      receivedBy: Prisma.sql`rcb."firstName"`,
      deletedAt: Prisma.sql`pc."deletedAt"`,
      deletedBy: Prisma.sql`db."firstName"`,
      delReason: Prisma.sql`pc."delReason"`,
      createdAt: Prisma.sql`pc."createdAt"`,
      createdBy: Prisma.sql`c."firstName"`,
      updatedAt: Prisma.sql`pc."updatedAt"`,
      updatedBy: Prisma.sql`u."firstName"`,
    };

    const orderByField =
      sortFieldMap[sortField] || Prisma.sql`pc."purchaseDate"`;
    const orderByDirection =
      sortOrderText === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const conditions: Prisma.Sql[] = [];

    if (loggedInUser.roleType === "ADMIN") {
      if (branchId) {
        conditions.push(Prisma.sql`pc."branchId" = ${branchId}`);
      }
    } else {
      if (!loggedInUser.branchId) {
        res.status(403).json({ message: "Branch not assigned." });
        return;
      }
      conditions.push(Prisma.sql`pc."branchId" = ${loggedInUser.branchId}`);
    }

    if (startDate && endDate) {
      conditions.push(
        Prisma.sql`pc."purchaseDate"::date BETWEEN ${startDate}::date AND ${endDate}::date`
      );
    } else if (startDate) {
      conditions.push(Prisma.sql`pc."purchaseDate"::date >= ${startDate}::date`);
    } else if (endDate) {
      conditions.push(Prisma.sql`pc."purchaseDate"::date <= ${endDate}::date`);
    }

    if (safeStatus) {
      conditions.push(Prisma.sql`pc."status" = ${safeStatus}::"PurchaseStatus"`);
    }

    if (searchTerm) {
      const searchWords = searchTerm.split(/\s+/).filter(Boolean);

      const searchConditions = searchWords.map((word) => {
        const likeWord = `%${word}%`;
        return Prisma.sql`
          (
            pc."ref" ILIKE ${likeWord}
            OR s."name" ILIKE ${likeWord}
            OR br."name" ILIKE ${likeWord}
            OR c."firstName" ILIKE ${likeWord}
            OR c."lastName" ILIKE ${likeWord}
            OR u."firstName" ILIKE ${likeWord}
            OR u."lastName" ILIKE ${likeWord}
            OR rcb."firstName" ILIKE ${likeWord}
            OR rcb."lastName" ILIKE ${likeWord}
            OR db."firstName" ILIKE ${likeWord}
            OR db."lastName" ILIKE ${likeWord}
            OR TO_CHAR(pc."purchaseDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(pc."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(pc."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(pc."receivedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(pc."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(pc."purchaseDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(pc."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(pc."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(pc."receivedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(pc."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
          )
        `;
      });

      conditions.push(
        Prisma.sql`(${Prisma.join(searchConditions, " AND ")})`
      );
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    const summaryResult = await prisma.$queryRaw<
      {
        totalPurchase: bigint;
        grandTotalAmount: Prisma.Decimal | number;
        totalPaidAmount: Prisma.Decimal | number;
        totalRemainAmount: Prisma.Decimal | number;
      }[]
    >`
      SELECT
        COUNT(DISTINCT pc."id") AS "totalPurchase",
        COALESCE(SUM(pc."grandTotal"), 0) AS "grandTotalAmount",
        COALESCE(SUM(pc."paidAmount"), 0) AS "totalPaidAmount",
        COALESCE(SUM(COALESCE(pc."grandTotal", 0) - COALESCE(pc."paidAmount", 0)), 0) AS "totalRemainAmount"
      FROM "Purchases" pc
      LEFT JOIN "Suppliers" s ON pc."supplierId" = s."id"
      LEFT JOIN "Branch" br ON pc."branchId" = br."id"
      LEFT JOIN "User" c ON pc."createdBy" = c."id"
      LEFT JOIN "User" u ON pc."updatedBy" = u."id"
      LEFT JOIN "User" rcb ON pc."receivedBy" = rcb."id"
      LEFT JOIN "User" db ON pc."deletedBy" = db."id"
      ${whereClause}
    `;

    let previousSummarySafe = {
      totalPurchase: 0,
      grandTotalAmount: 0,
      totalPaidAmount: 0,
      totalRemainAmount: 0,
    };

    let growth = 0;

    if (startDate && endDate) {
      const start = dayjs(startDate);
      const end = dayjs(endDate);
      const diffDays = end.diff(start, "day") + 1;

      const prevStart = start.subtract(diffDays, "day").format("YYYY-MM-DD");
      const prevEnd = start.subtract(1, "day").format("YYYY-MM-DD");

      const previousConditions: Prisma.Sql[] = [];

      if (loggedInUser.roleType === "ADMIN") {
        if (branchId) {
          previousConditions.push(Prisma.sql`pc."branchId" = ${branchId}`);
        }
      } else if (loggedInUser.branchId) {
        previousConditions.push(
          Prisma.sql`pc."branchId" = ${loggedInUser.branchId}`
        );
      }

      previousConditions.push(
        Prisma.sql`pc."purchaseDate"::date BETWEEN ${prevStart}::date AND ${prevEnd}::date`
      );

      if (safeStatus) {
        previousConditions.push(
          Prisma.sql`pc."status" = ${safeStatus}::"PurchaseStatus"`
        );
      }

      const previousWhereClause =
        previousConditions.length > 0
          ? Prisma.sql`WHERE ${Prisma.join(previousConditions, " AND ")}`
          : Prisma.empty;

      const previousSummary = await prisma.$queryRaw<
        {
          totalPurchase: bigint;
          grandTotalAmount: Prisma.Decimal | number;
          totalPaidAmount: Prisma.Decimal | number;
          totalRemainAmount: Prisma.Decimal | number;
        }[]
      >`
        SELECT
          COUNT(DISTINCT pc."id") AS "totalPurchase",
          COALESCE(SUM(pc."grandTotal"), 0) AS "grandTotalAmount",
          COALESCE(SUM(pc."paidAmount"), 0) AS "totalPaidAmount",
          COALESCE(SUM(COALESCE(pc."grandTotal", 0) - COALESCE(pc."paidAmount", 0)), 0) AS "totalRemainAmount"
        FROM "Purchases" pc
        ${previousWhereClause}
      `;

      previousSummarySafe = {
        totalPurchase: Number(previousSummary?.[0]?.totalPurchase || 0),
        grandTotalAmount: Number(previousSummary?.[0]?.grandTotalAmount || 0),
        totalPaidAmount: Number(previousSummary?.[0]?.totalPaidAmount || 0),
        totalRemainAmount: Number(previousSummary?.[0]?.totalRemainAmount || 0),
      };

      const currentTotal = Number(summaryResult?.[0]?.grandTotalAmount || 0);
      const previousTotal = previousSummarySafe.grandTotalAmount;

      if (previousTotal > 0) {
        growth = ((currentTotal - previousTotal) / previousTotal) * 100;
      } else if (previousTotal === 0 && currentTotal === 0) {
        growth = 0;
      } else {
        growth = 0;
      }
    }

    let dateGroup: Prisma.Sql = Prisma.sql`DATE(pc."purchaseDate")`;
    if (groupBy === "week") {
      dateGroup = Prisma.sql`DATE_TRUNC('week', pc."purchaseDate")`;
    } else if (groupBy === "month") {
      dateGroup = Prisma.sql`DATE_TRUNC('month', pc."purchaseDate")`;
    }

    const chartData = await prisma.$queryRaw<any[]>`
      SELECT
        ${dateGroup} AS period,
        COUNT(*)::int AS "totalPurchase",
        COALESCE(SUM(pc."grandTotal"), 0)::float AS "totalAmount"
      FROM "Purchases" pc
      LEFT JOIN "Suppliers" s ON pc."supplierId" = s."id"
      LEFT JOIN "Branch" br ON pc."branchId" = br."id"
      LEFT JOIN "User" c ON pc."createdBy" = c."id"
      LEFT JOIN "User" u ON pc."updatedBy" = u."id"
      LEFT JOIN "User" rcb ON pc."receivedBy" = rcb."id"
      LEFT JOIN "User" db ON pc."deletedBy" = db."id"
      ${whereClause}
      GROUP BY period
      ORDER BY period ASC
    `;

    const totalResult = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM (
        SELECT pc."id"
        FROM "Purchases" pc
        LEFT JOIN "Suppliers" s ON pc."supplierId" = s."id"
        LEFT JOIN "Branch" br ON pc."branchId" = br."id"
        LEFT JOIN "User" c ON pc."createdBy" = c."id"
        LEFT JOIN "User" u ON pc."updatedBy" = u."id"
        LEFT JOIN "User" rcb ON pc."receivedBy" = rcb."id"
        LEFT JOIN "User" db ON pc."deletedBy" = db."id"
        ${whereClause}
      ) AS t
    `;

    const purchases = await prisma.$queryRaw<any[]>`
      SELECT
        pc.*,
        json_build_object('id', s."id", 'name', s."name") AS supplier,
        json_build_object('id', br."id", 'name', br."name") AS branch,
        json_build_object('id', c."id", 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
        json_build_object('id', u."id", 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
        json_build_object('id', rcb."id", 'firstName', rcb."firstName", 'lastName', rcb."lastName") AS receiver,
        json_build_object('id', db."id", 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
      FROM "Purchases" pc
      LEFT JOIN "Suppliers" s ON pc."supplierId" = s."id"
      LEFT JOIN "Branch" br ON pc."branchId" = br."id"
      LEFT JOIN "User" c ON pc."createdBy" = c."id"
      LEFT JOIN "User" u ON pc."updatedBy" = u."id"
      LEFT JOIN "User" rcb ON pc."receivedBy" = rcb."id"
      LEFT JOIN "User" db ON pc."deletedBy" = db."id"
      ${whereClause}
      ORDER BY ${orderByField} ${orderByDirection}
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const summarySafe = {
      totalPurchase: Number(summaryResult?.[0]?.totalPurchase || 0),
      grandTotalAmount: Number(summaryResult?.[0]?.grandTotalAmount || 0),
      totalPaidAmount: Number(summaryResult?.[0]?.totalPaidAmount || 0),
      totalRemainAmount: Number(summaryResult?.[0]?.totalRemainAmount || 0),
    };

    const purchaseSafe = purchases.map((quote: any) => ({
      ...quote,
      id: Number(quote.id),
      branchId: Number(quote.branchId),
      supplierId: quote.supplierId ? Number(quote.supplierId) : null,
      createdBy: quote.createdBy ? Number(quote.createdBy) : null,
      updatedBy: quote.updatedBy ? Number(quote.updatedBy) : null,
      receivedBy: quote.receivedBy ? Number(quote.receivedBy) : null,
      deletedBy: quote.deletedBy ? Number(quote.deletedBy) : null,
      grandTotal: Number(quote.grandTotal || 0),
      paidAmount: Number(quote.paidAmount || 0),
      dueAmount:
        Number(quote.grandTotal || 0) - Number(quote.paidAmount || 0),
    }));

    res.status(200).json({
      data: purchaseSafe,
      total: Number(totalResult?.[0]?.total || 0),
      summary: summarySafe,
      previousSummary: previousSummarySafe,
      growth: Number(growth.toFixed(1)),
      chart: chartData,
    });
  } catch (error) {
    console.error("Report purchase error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllPaymentPurchases = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pageSize = getQueryNumber(req.query.pageSize, 10)!;
    const pageNumber = getQueryNumber(req.query.page, 1)!;
    const offset = (pageNumber - 1) * pageSize;

    const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
    const sortField = getQueryString(req.query.sortField, "paymentDate")!;
    const sortOrderText =
      getQueryString(req.query.sortOrder, "desc")!.toLowerCase() === "asc"
        ? "asc"
        : "desc";

    const startDate = getQueryString(req.query.startDate, "") || undefined;
    const endDate = getQueryString(req.query.endDate, "") || undefined;
    const status = getQueryString(req.query.status, "") || undefined;
    const branchId = req.query.branchId
      ? parseInt(req.query.branchId as string, 10)
      : undefined;

    const loggedInUser = req.user;
    if (!loggedInUser) {
      res.status(401).json({ message: "User is not authenticated." });
      return;
    }

    const allowedStatuses = ["PAID", "CANCELLED"];
    const safeStatus =
      status && allowedStatuses.includes(status) ? status : undefined;

    const sortFieldMap: Record<string, Prisma.Sql> = {
      id: Prisma.sql`op."id"`,
      paymentDate: Prisma.sql`op."paymentDate"`,
      ref: Prisma.sql`o."ref"`,
      supplierId: Prisma.sql`s."name"`,
      branchId: Prisma.sql`br."name"`,
      paymentMethodId: Prisma.sql`pm."name"`,
      amount: Prisma.sql`op."amount"`,
      receive_usd: Prisma.sql`op."receive_usd"`,
      receive_khr: Prisma.sql`op."receive_khr"`,
      exchangerate: Prisma.sql`op."exchangerate"`,
      status: Prisma.sql`op."status"`,
      createdAt: Prisma.sql`op."createdAt"`,
      createdBy: Prisma.sql`c."firstName"`,
      deletedAt: Prisma.sql`op."deletedAt"`,
      deletedBy: Prisma.sql`db."firstName"`,
      delReason: Prisma.sql`op."delReason"`,
    };

    const orderByField = sortFieldMap[sortField] || Prisma.sql`op."paymentDate"`;
    const orderByDirection =
      sortOrderText === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const conditions: Prisma.Sql[] = [];

    if (loggedInUser.roleType === "ADMIN") {
      if (branchId) {
        conditions.push(Prisma.sql`o."branchId" = ${branchId}`);
      }
    } else {
      if (!loggedInUser.branchId) {
        res.status(403).json({ message: "Branch not assigned." });
        return;
      }
      conditions.push(Prisma.sql`o."branchId" = ${loggedInUser.branchId}`);
    }

    if (safeStatus) {
      conditions.push(Prisma.sql`op."status" = ${safeStatus}`);
    }

    if (startDate && endDate) {
      conditions.push(
        Prisma.sql`op."paymentDate"::date BETWEEN ${startDate}::date AND ${endDate}::date`
      );
    } else if (startDate) {
      conditions.push(Prisma.sql`op."paymentDate"::date >= ${startDate}::date`);
    } else if (endDate) {
      conditions.push(Prisma.sql`op."paymentDate"::date <= ${endDate}::date`);
    } else {
      conditions.push(Prisma.sql`op."paymentDate"::date = CURRENT_DATE`);
    }

    if (searchTerm) {
      const searchWords = searchTerm.split(/\s+/).filter(Boolean);

      const searchConditions = searchWords.map((word) => {
        const likeWord = `%${word}%`;

        return Prisma.sql`
          (
            o."ref" ILIKE ${likeWord}
            OR s."name" ILIKE ${likeWord}
            OR br."name" ILIKE ${likeWord}
            OR pm."name" ILIKE ${likeWord}
            OR c."firstName" ILIKE ${likeWord}
            OR c."lastName" ILIKE ${likeWord}
            OR db."firstName" ILIKE ${likeWord}
            OR db."lastName" ILIKE ${likeWord}
            OR TO_CHAR(op."paymentDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(op."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(op."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(op."paymentDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(op."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(op."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
          )
        `;
      });

      conditions.push(
        Prisma.sql`(${Prisma.join(searchConditions, " AND ")})`
      );
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    const summaryResult = await prisma.$queryRaw<
      { totalPayments: bigint; totalPaid: Prisma.Decimal | number }[]
    >`
      SELECT
        COUNT(op."id") AS "totalPayments",
        COALESCE(SUM(op."amount"), 0) AS "totalPaid"
      FROM "PurchaseOnPayments" op
      LEFT JOIN "Purchases" o ON op."purchaseId" = o."id"
      LEFT JOIN "Suppliers" s ON o."supplierId" = s."id"
      LEFT JOIN "Branch" br ON o."branchId" = br."id"
      LEFT JOIN "PaymentMethods" pm ON op."paymentMethodId" = pm."id"
      LEFT JOIN "User" c ON op."createdBy" = c."id"
      LEFT JOIN "User" db ON op."deletedBy" = db."id"
      ${whereClause}
    `;

    const totalResult = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM "PurchaseOnPayments" op
      LEFT JOIN "Purchases" o ON op."purchaseId" = o."id"
      LEFT JOIN "Suppliers" s ON o."supplierId" = s."id"
      LEFT JOIN "Branch" br ON o."branchId" = br."id"
      LEFT JOIN "PaymentMethods" pm ON op."paymentMethodId" = pm."id"
      LEFT JOIN "User" c ON op."createdBy" = c."id"
      LEFT JOIN "User" db ON op."deletedBy" = db."id"
      ${whereClause}
    `;

    const payments = await prisma.$queryRaw<any[]>`
      SELECT
        op.*,
        json_build_object(
          'id', o."id",
          'ref', o."ref",
          'purchaseDate', o."purchaseDate",
          'status', o."status",
          'grandTotal', o."grandTotal",
          'paidAmount', o."paidAmount"
        ) AS "purchase",
        json_build_object(
          'id', pm."id",
          'name', pm."name"
        ) AS "PaymentMethods",
        json_build_object('id', s."id", 'name', s."name") AS supplier,
        json_build_object('id', br."id", 'name', br."name") AS branch,
        json_build_object('id', c."id", 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
        json_build_object('id', db."id", 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
      FROM "PurchaseOnPayments" op
      LEFT JOIN "Purchases" o ON op."purchaseId" = o."id"
      LEFT JOIN "Suppliers" s ON o."supplierId" = s."id"
      LEFT JOIN "PaymentMethods" pm ON op."paymentMethodId" = pm."id"
      LEFT JOIN "Branch" br ON o."branchId" = br."id"
      LEFT JOIN "User" c ON op."createdBy" = c."id"
      LEFT JOIN "User" db ON op."deletedBy" = db."id"
      ${whereClause}
      ORDER BY ${orderByField} ${orderByDirection}
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const summary = {
      totalPayments: Number(summaryResult?.[0]?.totalPayments || 0),
      totalPaid: Number(summaryResult?.[0]?.totalPaid || 0),
    };

    const paymentsSafe = payments.map((p: any) => ({
      ...p,
      id: Number(p.id),
      purchaseId: Number(p.purchaseId),
      paymentMethodId: p.paymentMethodId ? Number(p.paymentMethodId) : null,
      amount: Number(p.amount || 0),
      receive_usd: Number(p.receive_usd || 0),
      receive_khr: Number(p.receive_khr || 0),
      exchangerate: Number(p.exchangerate || 0),
      createdBy: p.createdBy ? Number(p.createdBy) : null,
      deletedBy: p.deletedBy ? Number(p.deletedBy) : null,
    }));

    res.status(200).json({
      data: paymentsSafe,
      total: Number(totalResult?.[0]?.total || 0),
      summary,
    });
  } catch (error) {
    console.error("Payment purchase report error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAllReportAdjustments = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const requestedSortField = getQueryString(req.query.sortField, "createdAt")!;
        const sortOrder =
            getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";

        const startDate = getQueryString(req.query.startDate, "")!.trim();
        const endDate = getQueryString(req.query.endDate, "")!.trim();
        const adjustType = getQueryString(req.query.adjustType, "")!.trim();
        const status = getQueryString(req.query.status, "")!.trim();
        const branchId = req.query.branchId ? Number(req.query.branchId) : null;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        const SORT_FIELD_MAP: Record<string, string> = {
            id: 'sam."id"',
            ref: 'sam."ref"',
            adjustDate: 'sam."adjustDate"',
            branchId: 'sam."branchId"',
            AdjustMentType: 'sam."AdjustMentType"',
            StatusType: 'sam."StatusType"',
            approvedAt: 'sam."approvedAt"',
            approvedBy: 'sam."approvedBy"',
            deletedAt: 'sam."deletedAt"',
            deletedBy: 'sam."deletedBy"',
            createdAt: 'sam."createdAt"',
            createdBy: 'sam."createdBy"',
            updatedAt: 'sam."updatedAt"',
            updatedBy: 'sam."updatedBy"',
            totalQuantity: '"totalQuantity"',
        };

        const safeSortField = SORT_FIELD_MAP[requestedSortField] || 'sam."createdAt"';

        const searchWords = searchTerm.split(/\s+/).filter(Boolean);
        const params: any[] = [];
        const whereParts: string[] = ['1=1'];

        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) {
                params.push(branchId);
                whereParts.push(`sam."branchId" = $${params.length}`);
            }
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            params.push(loggedInUser.branchId);
            whereParts.push(`sam."branchId" = $${params.length}`);
        }

        if (startDate && endDate) {
            params.push(startDate);
            params.push(endDate);
            whereParts.push(`sam."adjustDate"::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
        } else if (startDate) {
            params.push(startDate);
            whereParts.push(`sam."adjustDate"::date >= $${params.length}::date`);
        } else if (endDate) {
            params.push(endDate);
            whereParts.push(`sam."adjustDate"::date <= $${params.length}::date`);
        }

        if (adjustType) {
            params.push(adjustType);
            whereParts.push(`sam."AdjustMentType"::text = $${params.length}`);
        }

        if (status) {
            params.push(status);
            whereParts.push(`sam."StatusType"::text = $${params.length}`);
        }

        if (searchTerm) {
            const likeTerm = `%${searchTerm}%`;
            params.push(likeTerm);
            const searchIndex = params.length;

            const wordConditions = searchWords.map((word) => {
                params.push(`%${word}%`);
                const idx = params.length;
                return `
                    (
                        c."firstName" ILIKE $${idx}
                        OR c."lastName" ILIKE $${idx}
                        OR u."firstName" ILIKE $${idx}
                        OR u."lastName" ILIKE $${idx}
                        OR ap."firstName" ILIKE $${idx}
                        OR ap."lastName" ILIKE $${idx}
                        OR db."firstName" ILIKE $${idx}
                        OR db."lastName" ILIKE $${idx}
                        OR br."name" ILIKE $${idx}
                    )
                `;
            });

            whereParts.push(`
                (
                    sam."ref" ILIKE $${searchIndex}
                    OR sam."note" ILIKE $${searchIndex}
                    OR sam."delReason" ILIKE $${searchIndex}
                    OR sam."StatusType"::text ILIKE $${searchIndex}
                    OR sam."AdjustMentType"::text ILIKE $${searchIndex}
                    OR br."name" ILIKE $${searchIndex}
                    OR TO_CHAR(sam."adjustDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sam."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sam."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sam."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sam."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sam."adjustDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sam."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sam."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sam."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sam."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    ${wordConditions.length ? `OR (${wordConditions.join(" AND ")})` : ""}
                )
            `);
        }

        const commonFilters = `WHERE ${whereParts.join(" AND ")}`;

        const totalQuery = `
            SELECT COUNT(*) AS total
            FROM (
                SELECT sam.id
                FROM "StockAdjustments" sam
                LEFT JOIN "AdjustmentDetails" ad ON ad."adjustmentId" = sam.id
                LEFT JOIN "Branch" br ON sam."branchId" = br.id
                LEFT JOIN "User" c ON sam."createdBy" = c.id
                LEFT JOIN "User" u ON sam."updatedBy" = u.id
                LEFT JOIN "User" ap ON sam."approvedBy" = ap.id
                LEFT JOIN "User" db ON sam."deletedBy" = db.id
                ${commonFilters}
                GROUP BY sam.id
            ) t
        `;

        const totalResult: any = await prisma.$queryRawUnsafe(totalQuery, ...params);
        const total = Number(totalResult[0]?.total || 0);

        const dataParams = [...params, pageSize, offset];

        const dataQuery = `
            SELECT 
                sam.*,
                COALESCE(SUM(ad."baseQty"), 0) AS "totalQuantity",

                json_build_object(
                    'id', br.id,
                    'name', br.name
                ) AS branch,

                json_build_object(
                    'id', c.id,
                    'firstName', c."firstName",
                    'lastName', c."lastName"
                ) AS creator,

                json_build_object(
                    'id', u.id,
                    'firstName', u."firstName",
                    'lastName', u."lastName"
                ) AS updater,

                json_build_object(
                    'id', ap.id,
                    'firstName', ap."firstName",
                    'lastName', ap."lastName"
                ) AS approver,

                json_build_object(
                    'id', db.id,
                    'firstName', db."firstName",
                    'lastName', db."lastName"
                ) AS deleter

            FROM "StockAdjustments" sam
            LEFT JOIN "AdjustmentDetails" ad ON ad."adjustmentId" = sam.id
            LEFT JOIN "Branch" br ON sam."branchId" = br.id
            LEFT JOIN "User" c ON sam."createdBy" = c.id
            LEFT JOIN "User" u ON sam."updatedBy" = u.id
            LEFT JOIN "User" ap ON sam."approvedBy" = ap.id
            LEFT JOIN "User" db ON sam."deletedBy" = db.id
            ${commonFilters}

            GROUP BY
                sam.id,
                br.id,
                c.id,
                u.id,
                ap.id,
                db.id

            ORDER BY ${safeSortField} ${sortOrder}
            LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
        `;

        const adjustments: any = await prisma.$queryRawUnsafe(dataQuery, ...dataParams);

        const adjustmentsSafe = adjustments.map((row: any) => ({
            ...row,
            id: Number(row.id),
            branchId: Number(row.branchId),
            totalQuantity: Number(row.totalQuantity || 0),
            createdBy: row.createdBy ? Number(row.createdBy) : null,
            updatedBy: row.updatedBy ? Number(row.updatedBy) : null,
            approvedBy: row.approvedBy ? Number(row.approvedBy) : null,
            deletedBy: row.deletedBy ? Number(row.deletedBy) : null,
        }));

        res.status(200).json({
            data: adjustmentsSafe,
            total,
        });
    } catch (error) {
        console.error("Report adjustment error:", error);
        res.status(500).json({ message: "Adjustment server error" });
    }
};

export const getAllReportTransfers = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const requestedSortField = getQueryString(req.query.sortField, "createdAt")!;
        const sortOrder =
            getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";

        const startDate = getQueryString(req.query.startDate, "")!.trim();
        const endDate = getQueryString(req.query.endDate, "")!.trim();
        const status = getQueryString(req.query.status, "")!.trim();
        const branchId = req.query.branchId ? Number(req.query.branchId) : null;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        const SORT_FIELD_MAP: Record<string, string> = {
            id: 'sts."id"',
            ref: 'sts."ref"',
            transferDate: 'sts."transferDate"',
            branchId: 'sts."branchId"',
            toBranchId: 'sts."toBranchId"',
            StatusType: 'sts."StatusType"',
            approvedAt: 'sts."approvedAt"',
            approvedBy: 'sts."approvedBy"',
            deletedAt: 'sts."deletedAt"',
            deletedBy: 'sts."deletedBy"',
            createdAt: 'sts."createdAt"',
            createdBy: 'sts."createdBy"',
            updatedAt: 'sts."updatedAt"',
            updatedBy: 'sts."updatedBy"',
            totalQuantity: '"totalQuantity"',
        };

        const safeSortField = SORT_FIELD_MAP[requestedSortField] || 'sts."createdAt"';

        const searchWords = searchTerm.split(/\s+/).filter(Boolean);
        const params: any[] = [];
        const whereParts: string[] = ['1=1'];

        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) {
                params.push(branchId);
                whereParts.push(`sts."branchId" = $${params.length}`);
            }
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            params.push(loggedInUser.branchId);
            whereParts.push(`sts."branchId" = $${params.length}`);
        }

        if (startDate && endDate) {
            params.push(startDate);
            params.push(endDate);
            whereParts.push(`sts."transferDate"::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
        } else if (startDate) {
            params.push(startDate);
            whereParts.push(`sts."transferDate"::date >= $${params.length}::date`);
        } else if (endDate) {
            params.push(endDate);
            whereParts.push(`sts."transferDate"::date <= $${params.length}::date`);
        }

        if (status) {
            params.push(status);
            
            whereParts.push(`sts."StatusType"::text = $${params.length}`);
        }

        if (searchTerm) {
            const likeTerm = `%${searchTerm}%`;
            params.push(likeTerm);
            const searchIndex = params.length;

            const wordConditions = searchWords.map((word) => {
                params.push(`%${word}%`);
                const idx = params.length;
                return `
                    (
                        c."firstName" ILIKE $${idx}
                        OR c."lastName" ILIKE $${idx}
                        OR u."firstName" ILIKE $${idx}
                        OR u."lastName" ILIKE $${idx}
                        OR ap."firstName" ILIKE $${idx}
                        OR ap."lastName" ILIKE $${idx}
                        OR db."firstName" ILIKE $${idx}
                        OR db."lastName" ILIKE $${idx}
                        OR br."name" ILIKE $${idx}
                        OR tbr."name" ILIKE $${idx}
                    )
                `;
            });

            whereParts.push(`
                (
                    sts."ref" ILIKE $${searchIndex}
                    OR sts."note" ILIKE $${searchIndex}
                    OR sts."delReason" ILIKE $${searchIndex}
                    OR sts."StatusType"::text ILIKE $${searchIndex}
                    OR br."name" ILIKE $${searchIndex}
                    OR tbr."name" ILIKE $${searchIndex}
                    OR TO_CHAR(sts."transferDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sts."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sts."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sts."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sts."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sts."transferDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sts."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sts."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sts."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(sts."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    ${wordConditions.length ? `OR (${wordConditions.join(" AND ")})` : ""}
                )
            `);
        }

        const commonFilters = `WHERE ${whereParts.join(" AND ")}`;

        const totalQuery = `
            SELECT COUNT(*) AS total
            FROM (
                SELECT sts.id
                FROM "StockTransfers" sts
                LEFT JOIN "TransferDetails" td ON td."transferId" = sts.id
                LEFT JOIN "Branch" br ON sts."branchId" = br.id
                LEFT JOIN "Branch" tbr ON sts."toBranchId" = tbr.id
                LEFT JOIN "User" c ON sts."createdBy" = c.id
                LEFT JOIN "User" u ON sts."updatedBy" = u.id
                LEFT JOIN "User" ap ON sts."approvedBy" = ap.id
                LEFT JOIN "User" db ON sts."deletedBy" = db.id
                ${commonFilters}
                GROUP BY sts.id
            ) t
        `;

        const totalResult: any = await prisma.$queryRawUnsafe(totalQuery, ...params);
        const total = Number(totalResult[0]?.total || 0);

        const dataParams = [...params, pageSize, offset];

        const dataQuery = `
            SELECT 
                sts.*,
                COALESCE(SUM(td."baseQty"), 0) AS "totalQuantity",

                json_build_object(
                    'id', br.id,
                    'name', br.name
                ) AS branch,

                json_build_object(
                    'id', tbr.id,
                    'name', tbr.name
                ) AS "toBranch",

                json_build_object(
                    'id', c.id,
                    'firstName', c."firstName",
                    'lastName', c."lastName"
                ) AS creator,

                json_build_object(
                    'id', u.id,
                    'firstName', u."firstName",
                    'lastName', u."lastName"
                ) AS updater,

                json_build_object(
                    'id', ap.id,
                    'firstName', ap."firstName",
                    'lastName', ap."lastName"
                ) AS approver,

                json_build_object(
                    'id', db.id,
                    'firstName', db."firstName",
                    'lastName', db."lastName"
                ) AS deleter

            FROM "StockTransfers" sts
            LEFT JOIN "TransferDetails" td ON td."transferId" = sts.id
            LEFT JOIN "Branch" br ON sts."branchId" = br.id
            LEFT JOIN "Branch" tbr ON sts."toBranchId" = tbr.id
            LEFT JOIN "User" c ON sts."createdBy" = c.id
            LEFT JOIN "User" u ON sts."updatedBy" = u.id
            LEFT JOIN "User" ap ON sts."approvedBy" = ap.id
            LEFT JOIN "User" db ON sts."deletedBy" = db.id
            ${commonFilters}

            GROUP BY
                sts.id,
                br.id,
                tbr.id,
                c.id,
                u.id,
                ap.id,
                db.id

            ORDER BY ${safeSortField} ${sortOrder}
            LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
        `;

        const transfers: any = await prisma.$queryRawUnsafe(dataQuery, ...dataParams);

        const transfersSafe = transfers.map((row: any) => ({
            ...row,
            id: Number(row.id),
            branchId: Number(row.branchId),
            toBranchId: row.toBranchId ? Number(row.toBranchId) : null,
            totalQuantity: Number(row.totalQuantity || 0),
            createdBy: row.createdBy ? Number(row.createdBy) : null,
            updatedBy: row.updatedBy ? Number(row.updatedBy) : null,
            approvedBy: row.approvedBy ? Number(row.approvedBy) : null,
            deletedBy: row.deletedBy ? Number(row.deletedBy) : null,
        }));

        res.status(200).json({
            data: transfersSafe,
            total,
        });
    } catch (error) {
        console.error("Transfer report error:", error);
        res.status(500).json({ message: "Transfer report server error" });
    }
};

export const getAllReportRequests = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const requestedSortField = getQueryString(req.query.sortField, "createdAt")!;
        const sortOrder =
            getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";

        const startDate = getQueryString(req.query.startDate, "")!.trim();
        const endDate = getQueryString(req.query.endDate, "")!.trim();
        const status = getQueryString(req.query.status, "")!.trim();
        const branchId = req.query.branchId ? Number(req.query.branchId) : null;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        const SORT_FIELD_MAP: Record<string, string> = {
            id: 'srq."id"',
            ref: 'srq."ref"',
            requestDate: 'srq."requestDate"',
            branchId: 'srq."branchId"',
            requestBy: 'srq."requestBy"',
            StatusType: 'srq."StatusType"',
            approvedAt: 'srq."approvedAt"',
            approvedBy: 'srq."approvedBy"',
            deletedAt: 'srq."deletedAt"',
            deletedBy: 'srq."deletedBy"',
            createdAt: 'srq."createdAt"',
            createdBy: 'srq."createdBy"',
            updatedAt: 'srq."updatedAt"',
            updatedBy: 'srq."updatedBy"',
            totalQuantity: '"totalQuantity"',
        };

        const safeSortField = SORT_FIELD_MAP[requestedSortField] || 'srq."createdAt"';

        const searchWords = searchTerm.split(/\s+/).filter(Boolean);
        const params: any[] = [];
        const whereParts: string[] = ['1=1'];

        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) {
                params.push(branchId);
                whereParts.push(`srq."branchId" = $${params.length}`);
            }
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            params.push(loggedInUser.branchId);
            whereParts.push(`srq."branchId" = $${params.length}`);
        }

        if (startDate && endDate) {
            params.push(startDate);
            params.push(endDate);
            whereParts.push(`srq."requestDate"::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
        } else if (startDate) {
            params.push(startDate);
            whereParts.push(`srq."requestDate"::date >= $${params.length}::date`);
        } else if (endDate) {
            params.push(endDate);
            whereParts.push(`srq."requestDate"::date <= $${params.length}::date`);
        }

        if (status) {
            params.push(status);
            whereParts.push(`srq."StatusType"::text = $${params.length}`);
        }

        if (searchTerm) {
            const likeTerm = `%${searchTerm}%`;
            params.push(likeTerm);
            const searchIndex = params.length;

            const wordConditions = searchWords.map((word) => {
                params.push(`%${word}%`);
                const idx = params.length;
                return `
                    (
                        c."firstName" ILIKE $${idx}
                        OR c."lastName" ILIKE $${idx}
                        OR u."firstName" ILIKE $${idx}
                        OR u."lastName" ILIKE $${idx}
                        OR ap."firstName" ILIKE $${idx}
                        OR ap."lastName" ILIKE $${idx}
                        OR db."firstName" ILIKE $${idx}
                        OR db."lastName" ILIKE $${idx}
                        OR rqb."firstName" ILIKE $${idx}
                        OR rqb."lastName" ILIKE $${idx}
                        OR br."name" ILIKE $${idx}
                    )
                `;
            });

            whereParts.push(`
                (
                    srq."ref" ILIKE $${searchIndex}
                    OR srq."note" ILIKE $${searchIndex}
                    OR srq."delReason" ILIKE $${searchIndex}
                    OR srq."StatusType"::text ILIKE $${searchIndex}
                    OR br."name" ILIKE $${searchIndex}
                    OR TO_CHAR(srq."requestDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srq."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srq."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srq."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srq."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srq."requestDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srq."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srq."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srq."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srq."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    ${wordConditions.length ? `OR (${wordConditions.join(" AND ")})` : ""}
                )
            `);
        }

        const commonFilters = `WHERE ${whereParts.join(" AND ")}`;

        const totalQuery = `
            SELECT COUNT(*) AS total
            FROM (
                SELECT srq.id
                FROM "StockRequests" srq
                LEFT JOIN "RequestDetails" rqd ON rqd."requestId" = srq.id
                LEFT JOIN "Branch" br ON srq."branchId" = br.id
                LEFT JOIN "User" c ON srq."createdBy" = c.id
                LEFT JOIN "User" u ON srq."updatedBy" = u.id
                LEFT JOIN "User" ap ON srq."approvedBy" = ap.id
                LEFT JOIN "User" db ON srq."deletedBy" = db.id
                LEFT JOIN "User" rqb ON srq."requestBy" = rqb.id
                ${commonFilters}
                GROUP BY srq.id
            ) t
        `;

        const totalResult: any = await prisma.$queryRawUnsafe(totalQuery, ...params);
        const total = Number(totalResult[0]?.total || 0);

        const dataParams = [...params, pageSize, offset];

        const dataQuery = `
            SELECT 
                srq.*,
                COALESCE(SUM(rqd."baseQty"), 0) AS "totalQuantity",

                json_build_object(
                    'id', br.id,
                    'name', br.name
                ) AS branch,

                json_build_object(
                    'id', c.id,
                    'firstName', c."firstName",
                    'lastName', c."lastName"
                ) AS creator,

                json_build_object(
                    'id', u.id,
                    'firstName', u."firstName",
                    'lastName', u."lastName"
                ) AS updater,

                json_build_object(
                    'id', ap.id,
                    'firstName', ap."firstName",
                    'lastName', ap."lastName"
                ) AS approver,

                json_build_object(
                    'id', db.id,
                    'firstName', db."firstName",
                    'lastName', db."lastName"
                ) AS deleter,

                json_build_object(
                    'id', rqb.id,
                    'firstName', rqb."firstName",
                    'lastName', rqb."lastName"
                ) AS requester

            FROM "StockRequests" srq
            LEFT JOIN "RequestDetails" rqd ON rqd."requestId" = srq.id
            LEFT JOIN "Branch" br ON srq."branchId" = br.id
            LEFT JOIN "User" c ON srq."createdBy" = c.id
            LEFT JOIN "User" u ON srq."updatedBy" = u.id
            LEFT JOIN "User" ap ON srq."approvedBy" = ap.id
            LEFT JOIN "User" db ON srq."deletedBy" = db.id
            LEFT JOIN "User" rqb ON srq."requestBy" = rqb.id
            ${commonFilters}

            GROUP BY
                srq.id,
                br.id,
                c.id,
                u.id,
                ap.id,
                db.id,
                rqb.id

            ORDER BY ${safeSortField} ${sortOrder}
            LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
        `;

        const requests: any = await prisma.$queryRawUnsafe(dataQuery, ...dataParams);

        const requestsSafe = requests.map((row: any) => ({
            ...row,
            id: Number(row.id),
            branchId: Number(row.branchId),
            totalQuantity: Number(row.totalQuantity || 0),
            createdBy: row.createdBy ? Number(row.createdBy) : null,
            updatedBy: row.updatedBy ? Number(row.updatedBy) : null,
            approvedBy: row.approvedBy ? Number(row.approvedBy) : null,
            deletedBy: row.deletedBy ? Number(row.deletedBy) : null,
            requestBy: row.requestBy ? Number(row.requestBy) : null,
        }));

        res.status(200).json({
            data: requestsSafe,
            total,
        });
    } catch (error) {
        console.error("Request report error:", error);
        res.status(500).json({ message: "Request report server error" });
    }
};

export const getAllReportReturns = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const requestedSortField = getQueryString(req.query.sortField, "createdAt")!;
        const sortOrder =
            getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "desc" : "asc";

        const startDate = getQueryString(req.query.startDate, "")!.trim();
        const endDate = getQueryString(req.query.endDate, "")!.trim();
        const status = getQueryString(req.query.status, "")!.trim();
        const branchId = req.query.branchId ? Number(req.query.branchId) : null;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        const SORT_FIELD_MAP: Record<string, string> = {
            id: 'srt."id"',
            ref: 'srt."ref"',
            returnDate: 'srt."returnDate"',
            branchId: 'srt."branchId"',
            StatusType: 'srt."StatusType"',
            approvedAt: 'srt."approvedAt"',
            approvedBy: 'srt."approvedBy"',
            deletedAt: 'srt."deletedAt"',
            deletedBy: 'srt."deletedBy"',
            createdAt: 'srt."createdAt"',
            createdBy: 'srt."createdBy"',
            updatedAt: 'srt."updatedAt"',
            updatedBy: 'srt."updatedBy"',
            totalQuantity: '"totalQuantity"',
        };

        const safeSortField = SORT_FIELD_MAP[requestedSortField] || 'srt."createdAt"';

        const searchWords = searchTerm.split(/\s+/).filter(Boolean);
        const params: any[] = [];
        const whereParts: string[] = ['1=1'];

        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) {
                params.push(branchId);
                whereParts.push(`srt."branchId" = $${params.length}`);
            }
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            params.push(loggedInUser.branchId);
            whereParts.push(`srt."branchId" = $${params.length}`);
        }

        if (startDate && endDate) {
            params.push(startDate);
            params.push(endDate);
            whereParts.push(`srt."returnDate"::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`);
        } else if (startDate) {
            params.push(startDate);
            whereParts.push(`srt."returnDate"::date >= $${params.length}::date`);
        } else if (endDate) {
            params.push(endDate);
            whereParts.push(`srt."returnDate"::date <= $${params.length}::date`);
        }

        if (status) {
            params.push(status);
            whereParts.push(`srt."StatusType"::text = $${params.length}`);
        }

        if (searchTerm) {
            const likeTerm = `%${searchTerm}%`;
            params.push(likeTerm);
            const searchIndex = params.length;

            const wordConditions = searchWords.map((word) => {
                params.push(`%${word}%`);
                const idx = params.length;
                return `
                    (
                        c."firstName" ILIKE $${idx}
                        OR c."lastName" ILIKE $${idx}
                        OR u."firstName" ILIKE $${idx}
                        OR u."lastName" ILIKE $${idx}
                        OR ap."firstName" ILIKE $${idx}
                        OR ap."lastName" ILIKE $${idx}
                        OR db."firstName" ILIKE $${idx}
                        OR db."lastName" ILIKE $${idx}
                        OR rtb."firstName" ILIKE $${idx}
                        OR rtb."lastName" ILIKE $${idx}
                        OR br."name" ILIKE $${idx}
                    )
                `;
            });

            whereParts.push(`
                (
                    srt."ref" ILIKE $${searchIndex}
                    OR srt."note" ILIKE $${searchIndex}
                    OR srt."delReason" ILIKE $${searchIndex}
                    OR srt."StatusType"::text ILIKE $${searchIndex}
                    OR br."name" ILIKE $${searchIndex}
                    OR TO_CHAR(srt."returnDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srt."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srt."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srt."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srt."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srt."returnDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srt."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srt."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srt."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    OR TO_CHAR(srt."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $${searchIndex}
                    ${wordConditions.length ? `OR (${wordConditions.join(" AND ")})` : ""}
                )
            `);
        }

        const commonFilters = `WHERE ${whereParts.join(" AND ")}`;

        const totalQuery = `
            SELECT COUNT(*) AS total
            FROM (
                SELECT srt.id
                FROM "StockReturns" srt
                LEFT JOIN "ReturnDetails" rtd ON rtd."returnId" = srt.id
                LEFT JOIN "Branch" br ON srt."branchId" = br.id
                LEFT JOIN "User" c ON srt."createdBy" = c.id
                LEFT JOIN "User" u ON srt."updatedBy" = u.id
                LEFT JOIN "User" ap ON srt."approvedBy" = ap.id
                LEFT JOIN "User" db ON srt."deletedBy" = db.id
                LEFT JOIN "User" rtb ON srt."returnBy" = rtb.id
                ${commonFilters}
                GROUP BY srt.id
            ) t
        `;

        const totalResult: any = await prisma.$queryRawUnsafe(totalQuery, ...params);
        const total = Number(totalResult[0]?.total || 0);

        const dataParams = [...params, pageSize, offset];

        const dataQuery = `
            SELECT 
                srt.*,
                COALESCE(SUM(rtd."baseQty"), 0) AS "totalQuantity",

                json_build_object(
                    'id', br.id,
                    'name', br.name
                ) AS branch,

                json_build_object(
                    'id', c.id,
                    'firstName', c."firstName",
                    'lastName', c."lastName"
                ) AS creator,

                json_build_object(
                    'id', u.id,
                    'firstName', u."firstName",
                    'lastName', u."lastName"
                ) AS updater,

                json_build_object(
                    'id', ap.id,
                    'firstName', ap."firstName",
                    'lastName', ap."lastName"
                ) AS approver,

                json_build_object(
                    'id', db.id,
                    'firstName', db."firstName",
                    'lastName', db."lastName"
                ) AS deleter,

                json_build_object(
                    'id', rtb.id,
                    'firstName', rtb."firstName",
                    'lastName', rtb."lastName"
                ) AS returner

            FROM "StockReturns" srt
            LEFT JOIN "ReturnDetails" rtd ON rtd."returnId" = srt.id
            LEFT JOIN "Branch" br ON srt."branchId" = br.id
            LEFT JOIN "User" c ON srt."createdBy" = c.id
            LEFT JOIN "User" u ON srt."updatedBy" = u.id
            LEFT JOIN "User" ap ON srt."approvedBy" = ap.id
            LEFT JOIN "User" db ON srt."deletedBy" = db.id
            LEFT JOIN "User" rtb ON srt."returnBy" = rtb.id
            ${commonFilters}

            GROUP BY
                srt.id,
                br.id,
                c.id,
                u.id,
                ap.id,
                db.id,
                rtb.id

            ORDER BY ${safeSortField} ${sortOrder}
            LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
        `;

        const returns: any = await prisma.$queryRawUnsafe(dataQuery, ...dataParams);

        const returnsSafe = returns.map((row: any) => ({
            ...row,
            id: Number(row.id),
            branchId: Number(row.branchId),
            totalQuantity: Number(row.totalQuantity || 0),
            createdBy: row.createdBy ? Number(row.createdBy) : null,
            updatedBy: row.updatedBy ? Number(row.updatedBy) : null,
            approvedBy: row.approvedBy ? Number(row.approvedBy) : null,
            deletedBy: row.deletedBy ? Number(row.deletedBy) : null,
            returnBy: row.returnBy ? Number(row.returnBy) : null,
        }));

        res.status(200).json({
            data: returnsSafe,
            total,
        });
    } catch (error) {
        console.error("Return report error:", error);
        res.status(500).json({ message: "Return report server error" });
    }
};

export const getAllReportExpenses = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        /* -------------------------------------------------- */
        /* PAGINATION & FILTER PARAMS                         */
        /* -------------------------------------------------- */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const rawSortField = getQueryString(req.query.sortField, "ref")!;
        const sortField = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawSortField) ? rawSortField : "ref";
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "desc" : "asc";

        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const status = req.query.status as string | undefined;
        const branchId = req.query.branchId
            ? parseInt(req.query.branchId as string, 10)
            : null;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        /* -------------------------------------------------- */
        /* SEARCH SETUP                                       */
        /* -------------------------------------------------- */
        const likeTerm = `%${searchTerm}%`;
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        const fullNameConditions = searchWords
            .map((_, idx) => `
                (
                    exp."name" ILIKE $${idx + 2}
                    OR c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR db."firstName" ILIKE $${idx + 2}
                    OR db."lastName" ILIKE $${idx + 2}
                    OR br."name" ILIKE $${idx + 2}
                )
            `)
            .join(" AND ");

        const params: any[] = [likeTerm, ...searchWords.map(w => `%${w}%`)];

        /* -------------------------------------------------- */
        /* BRANCH RESTRICTION                                 */
        /* -------------------------------------------------- */
        let branchRestriction = "";
        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) branchRestriction = `AND exp."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND exp."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------------------------------------- */
        /* COMMON FILTERS                                     */
        /* -------------------------------------------------- */
        
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${startDate && endDate ? `AND exp."expenseDate"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            AND (
                exp."name" ILIKE $1
                OR br."name" ILIKE $1
                OR TO_CHAR(exp."expenseDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(exp."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(exp."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(exp."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(exp."expenseDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(exp."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(exp."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(exp."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------------------------------------- */
        /* 21 TOTAL COUNT (PAGINATION)                       */
        /* -------------------------------------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT exp.id
                FROM "Expenses" exp
                LEFT JOIN "Branch" br ON exp."branchId" = br.id
                LEFT JOIN "User" c ON exp."createdBy" = c.id
                LEFT JOIN "User" u ON exp."updatedBy" = u.id
                LEFT JOIN "User" db ON exp."deletedBy" = db.id
                ${commonFilters}
                GROUP BY exp.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------------------------------------- */
        /* 3️ DATA LIST                                      */
        /* -------------------------------------------------- */
        const expenses: any = await prisma.$queryRawUnsafe(`
            SELECT 
                exp.*,
                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter

            FROM "Expenses" exp
                LEFT JOIN "Branch" br ON exp."branchId" = br.id
                LEFT JOIN "User" c ON exp."createdBy" = c.id
                LEFT JOIN "User" u ON exp."updatedBy" = u.id
                LEFT JOIN "User" db ON exp."deletedBy" = db.id
                ${commonFilters}

            ORDER BY exp."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const expensesSafe = expenses.map((exps: any) => ({
            ...exps,
            id: Number(exps.id),
            branchId: Number(exps.branchId),
            createdBy: exps.createdBy ? Number(exps.createdBy) : null,
            updatedBy: exps.updatedBy ? Number(exps.updatedBy) : null,
            deletedBy: exps.deletedBy ? Number(exps.deletedBy) : null
        }));

        // console.log("Data: ", expenses);
        // console.log("Summary: ", summarySafe);

        res.status(200).json({
            data: expensesSafe,
            total
        });

    } catch (error) {
        console.error("Report expense error:", error);
        res.status(500).json({ message: "Expense report server error" });
    }
};

export const getAllReportIncomes = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        /* -------------------------------------------------- */
        /* PAGINATION & FILTER PARAMS                         */
        /* -------------------------------------------------- */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const rawSortField = getQueryString(req.query.sortField, "ref")!;
        const sortField = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawSortField) ? rawSortField : "ref";
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "desc" : "asc";

        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const status = req.query.status as string | undefined;
        const branchId = req.query.branchId
            ? parseInt(req.query.branchId as string, 10)
            : null;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        /* -------------------------------------------------- */
        /* SEARCH SETUP                                       */
        /* -------------------------------------------------- */
        const likeTerm = `%${searchTerm}%`;
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        const fullNameConditions = searchWords
            .map((_, idx) => `
                (
                    inc."name" ILIKE $${idx + 2}
                    OR c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR db."firstName" ILIKE $${idx + 2}
                    OR db."lastName" ILIKE $${idx + 2}
                    OR br."name" ILIKE $${idx + 2}
                )
            `)
            .join(" AND ");

        const params: any[] = [likeTerm, ...searchWords.map(w => `%${w}%`)];

        /* -------------------------------------------------- */
        /* BRANCH RESTRICTION                                 */
        /* -------------------------------------------------- */
        let branchRestriction = "";
        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) branchRestriction = `AND inc."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND inc."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------------------------------------- */
        /* COMMON FILTERS                                     */
        /* -------------------------------------------------- */
        
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${startDate && endDate ? `AND inc."incomeDate"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            AND (
                inc."name" ILIKE $1
                OR br."name" ILIKE $1
                OR TO_CHAR(inc."incomeDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(inc."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(inc."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(inc."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(inc."incomeDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(inc."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(inc."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(inc."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------------------------------------- */
        /* 21 TOTAL COUNT (PAGINATION)                       */
        /* -------------------------------------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT inc.id
                FROM "Incomes" inc
                LEFT JOIN "Branch" br ON inc."branchId" = br.id
                LEFT JOIN "User" c ON inc."createdBy" = c.id
                LEFT JOIN "User" u ON inc."updatedBy" = u.id
                LEFT JOIN "User" db ON inc."deletedBy" = db.id
                ${commonFilters}
                GROUP BY inc.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------------------------------------- */
        /* 3️ DATA LIST                                      */
        /* -------------------------------------------------- */
        const incomes: any = await prisma.$queryRawUnsafe(`
            SELECT 
                inc.*,
                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter

            FROM "Incomes" inc
                LEFT JOIN "Branch" br ON inc."branchId" = br.id
                LEFT JOIN "User" c ON inc."createdBy" = c.id
                LEFT JOIN "User" u ON inc."updatedBy" = u.id
                LEFT JOIN "User" db ON inc."deletedBy" = db.id
                ${commonFilters}

            ORDER BY inc."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const incomesSafe = incomes.map((incs: any) => ({
            ...incs,
            id: Number(incs.id),
            branchId: Number(incs.branchId),
            createdBy: incs.createdBy ? Number(incs.createdBy) : null,
            updatedBy: incs.updatedBy ? Number(incs.updatedBy) : null,
            deletedBy: incs.deletedBy ? Number(incs.deletedBy) : null
        }));

        // console.log("Data: ", incomes);
        // console.log("Summary: ", summarySafe);

        res.status(200).json({
            data: incomesSafe,
            total
        });

    } catch (error) {
        console.error("Report income error:", error);
        res.status(500).json({ message: "Income report server error" });
    }
};

export const getAllReportSalesReturns = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const pageSize = getQueryNumber(req.query.pageSize, 10)!;
    const pageNumber = getQueryNumber(req.query.page, 1)!;
    const offset = (pageNumber - 1) * pageSize;

    const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
    const sortField = getQueryString(req.query.sortField, "createdAt")!;
    const sortOrderText =
      getQueryString(req.query.sortOrder, "desc")!.toLowerCase() === "asc"
        ? "asc"
        : "desc";

    const startDate = getQueryString(req.query.startDate, "") || undefined;
    const endDate = getQueryString(req.query.endDate, "") || undefined;
    const saleType = getQueryString(req.query.saleType, "") || undefined;
    const status = getQueryString(req.query.status, "") || undefined;
    const branchId = req.query.branchId
      ? parseInt(req.query.branchId as string, 10)
      : undefined;

    const loggedInUser = req.user;
    if (!loggedInUser) {
      res.status(401).json({ message: "User is not authenticated." });
      return;
    }

    const sortFieldMap: Record<string, Prisma.Sql> = {
      id: Prisma.sql`sr."id"`,
      ref: Prisma.sql`sr."ref"`,
      order: Prisma.sql`o."ref"`,
      customer: Prisma.sql`cs."name"`,
      branch: Prisma.sql`br."name"`,
      discount: Prisma.sql`sr."discount"`,
      taxRate: Prisma.sql`sr."taxRate"`,
      taxNet: Prisma.sql`sr."taxNet"`,
      shipping: Prisma.sql`sr."shipping"`,
      totalAmount: Prisma.sql`sr."totalAmount"`,
      createdAt: Prisma.sql`sr."createdAt"`,
      updatedAt: Prisma.sql`sr."updatedAt"`,
      createdBy: Prisma.sql`c."firstName"`,
      status: Prisma.sql`sr."status"`,
      saleType: Prisma.sql`o."OrderSaleType"`,
    };

    const orderByField = sortFieldMap[sortField] || Prisma.sql`sr."createdAt"`;
    const orderByDirection =
      sortOrderText === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const conditions: Prisma.Sql[] = [];

    if (loggedInUser.roleType === "ADMIN") {
      if (branchId) {
        conditions.push(Prisma.sql`sr."branchId" = ${branchId}`);
      }
    } else {
      if (!loggedInUser.branchId) {
        res.status(403).json({ message: "Branch not assigned." });
        return;
      }
      conditions.push(Prisma.sql`sr."branchId" = ${loggedInUser.branchId}`);
    }

    if (startDate && endDate) {
      conditions.push(
        Prisma.sql`sr."createdAt"::date BETWEEN ${startDate}::date AND ${endDate}::date`
      );
    } else if (startDate) {
      conditions.push(Prisma.sql`sr."createdAt"::date >= ${startDate}::date`);
    } else if (endDate) {
      conditions.push(Prisma.sql`sr."createdAt"::date <= ${endDate}::date`);
    }

    if (saleType && saleType !== "ALL") {
      conditions.push(
        Prisma.sql`o."OrderSaleType" = ${saleType}::"QuoteSaleType"`
      );
    }

    const allowedStatuses = ["PENDING", "APPROVED", "CANCELLED"];
    const safeStatus =
    status && status !== "ALL" && allowedStatuses.includes(status)
        ? status
        : undefined;

    if (safeStatus) {
    conditions.push(
        Prisma.sql`sr."status" = ${safeStatus}::"StatusType"`
    );
    }

    if (searchTerm) {
      const searchWords = searchTerm.split(/\s+/).filter(Boolean);

      const searchConditions = searchWords.map((word) => {
        const likeWord = `%${word}%`;
        return Prisma.sql`
          (
            sr."ref" ILIKE ${likeWord}
            OR o."ref" ILIKE ${likeWord}
            OR cs."name" ILIKE ${likeWord}
            OR br."name" ILIKE ${likeWord}
            OR c."firstName" ILIKE ${likeWord}
            OR c."lastName" ILIKE ${likeWord}
            OR u."firstName" ILIKE ${likeWord}
            OR u."lastName" ILIKE ${likeWord}
            OR TO_CHAR(sr."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(sr."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(sr."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
            OR TO_CHAR(sr."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE ${likeWord}
          )
        `;
      });

      conditions.push(
        Prisma.sql`(${Prisma.join(searchConditions, " AND ")})`
      );
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    const summaryResult = await prisma.$queryRaw<
      {
        totalNumberSaleReturn: bigint;
        totalAmount: Prisma.Decimal | number;
        totalDiscount: Prisma.Decimal | number;
        totalTax: Prisma.Decimal | number;
        totalShipping: Prisma.Decimal | number;
        totalReturnCost: Prisma.Decimal | number;
        grossImpact: Prisma.Decimal | number;
      }[]
    >`
      SELECT
        COUNT(DISTINCT sr."id") AS "totalNumberSaleReturn",
        COALESCE(SUM(sr."totalAmount"), 0) AS "totalAmount",
        COALESCE(SUM(sr."discount"), 0) AS "totalDiscount",
        COALESCE(SUM(sr."taxNet"), 0) AS "totalTax",
        COALESCE(SUM(sr."shipping"), 0) AS "totalShipping",
        COALESCE(SUM(item_summary."returnCost"), 0) AS "totalReturnCost",
        COALESCE(SUM(sr."totalAmount"), 0) - COALESCE(SUM(item_summary."returnCost"), 0) AS "grossImpact"
      FROM "SaleReturns" sr
      LEFT JOIN "Customer" cs ON sr."customerId" = cs."id"
      LEFT JOIN "Branch" br ON sr."branchId" = br."id"
      LEFT JOIN "User" c ON sr."createdBy" = c."id"
      LEFT JOIN "User" u ON sr."updatedBy" = u."id"
      LEFT JOIN "Order" o ON sr."orderId" = o."id"
      LEFT JOIN (
        SELECT
          sri."saleReturnId",
          COALESCE(SUM(
            COALESCE(oi."cogs", 0)
          ), 0) AS "returnCost"
        FROM "SaleReturnItems" sri
        LEFT JOIN "OrderItem" oi ON sri."saleItemId" = oi."id"
        GROUP BY sri."saleReturnId"
      ) item_summary ON item_summary."saleReturnId" = sr."id"
      ${whereClause}
    `;

    const totalResult = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM "SaleReturns" sr
      LEFT JOIN "Customer" cs ON sr."customerId" = cs."id"
      LEFT JOIN "Branch" br ON sr."branchId" = br."id"
      LEFT JOIN "User" c ON sr."createdBy" = c."id"
      LEFT JOIN "User" u ON sr."updatedBy" = u."id"
      LEFT JOIN "Order" o ON sr."orderId" = o."id"
      ${whereClause}
    `;

    const saleReturns = await prisma.$queryRaw<any[]>`
      SELECT
        sr.*,
        COALESCE(item_summary."returnCost", 0) AS "returnCost",
        COALESCE(sr."totalAmount", 0) - COALESCE(item_summary."returnCost", 0) AS "grossImpact",
        json_build_object(
          'id', cs."id",
          'name', cs."name"
        ) AS customer,
        json_build_object(
          'id', br."id",
          'name', br."name"
        ) AS branch,
        json_build_object(
          'id', c."id",
          'firstName', c."firstName",
          'lastName', c."lastName"
        ) AS creator,
        json_build_object(
          'id', u."id",
          'firstName', u."firstName",
          'lastName', u."lastName"
        ) AS updater,
        json_build_object(
          'id', o."id",
          'ref', o."ref",
          'OrderSaleType', o."OrderSaleType",
          'status', o."status",
          'orderDate', o."orderDate"
        ) AS "order"
      FROM "SaleReturns" sr
      LEFT JOIN "Customer" cs ON sr."customerId" = cs."id"
      LEFT JOIN "Branch" br ON sr."branchId" = br."id"
      LEFT JOIN "User" c ON sr."createdBy" = c."id"
      LEFT JOIN "User" u ON sr."updatedBy" = u."id"
      LEFT JOIN "Order" o ON sr."orderId" = o."id"
      LEFT JOIN (
        SELECT
          sri."saleReturnId",
          COALESCE(SUM(
            COALESCE(oi."cogs", 0)
          ), 0) AS "returnCost"
        FROM "SaleReturnItems" sri
        LEFT JOIN "OrderItem" oi ON sri."saleItemId" = oi."id"
        GROUP BY sri."saleReturnId"
      ) item_summary ON item_summary."saleReturnId" = sr."id"
      ${whereClause}
      ORDER BY ${orderByField} ${orderByDirection}
      LIMIT ${pageSize}
      OFFSET ${offset}
    `;

    const data = saleReturns.map((row) => ({
      ...row,
      id: Number(row.id),
      branchId: row.branchId ? Number(row.branchId) : null,
      orderId: row.orderId ? Number(row.orderId) : null,
      customerId: row.customerId ? Number(row.customerId) : null,
      createdBy: row.createdBy ? Number(row.createdBy) : null,
      updatedBy: row.updatedBy ? Number(row.updatedBy) : null,
      deletedBy: row.deletedBy ? Number(row.deletedBy) : null,
      taxRate: Number(row.taxRate || 0),
      taxNet: Number(row.taxNet || 0),
      discount: Number(row.discount || 0),
      shipping: Number(row.shipping || 0),
      totalAmount: Number(row.totalAmount || 0),
      returnCost: Number(row.returnCost || 0),
      grossImpact: Number(row.grossImpact || 0),
      grandTotal: Number(row.totalAmount || 0),
    }));

    res.status(200).json({
      data,
      total: Number(totalResult?.[0]?.total || 0),
      summary: {
        totalNumberSaleReturn: Number(summaryResult?.[0]?.totalNumberSaleReturn || 0),
        totalAmount: Number(summaryResult?.[0]?.totalAmount || 0),
        totalDiscount: Number(summaryResult?.[0]?.totalDiscount || 0),
        totalTax: Number(summaryResult?.[0]?.totalTax || 0),
        totalShipping: Number(summaryResult?.[0]?.totalShipping || 0),
        totalReturnCost: Number(summaryResult?.[0]?.totalReturnCost || 0),
        grossImpact: Number(summaryResult?.[0]?.grossImpact || 0),
      },
    });
  } catch (error) {
    console.error("Report sale return error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getDashboardTopSellingProducts = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
        const branchId = req.query.branchId
        ? parseInt(req.query.branchId as string, 10)
        : null;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        let branchRestriction = "";
        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) {
                branchRestriction = `AND o."branchId" = ${branchId}`;
            }
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND o."branchId" = ${loggedInUser.branchId}`;
        }

        const dateFilter =
        startDate && endDate
            ? `AND o."orderDate"::date BETWEEN '${startDate}' AND '${endDate}'`
            : "";

        const data: any = await prisma.$queryRawUnsafe(`
            SELECT
                pv.id AS "productVariantId",
                p.id AS "productId",
                p.name AS "productName",
                pv.name AS "variantName",
                pv.sku AS "sku",
                pv.barcode AS "barcode",
                COALESCE(SUM(COALESCE(oi."baseQty", oi.quantity, 0)), 0) AS "totalQty",
                COALESCE(SUM(oi.total), 0) AS "totalRevenue",
                COALESCE(MAX(st.quantity), 0) AS "currentStock",
                COALESCE(pv."stockAlert", 0) AS "stockAlert",
                json_build_object(
                'id', b.id,
                'name', b.name
                ) AS branch
            FROM "OrderItem" oi
            INNER JOIN "Order" o ON oi."orderId" = o.id
            INNER JOIN "ProductVariants" pv ON oi."productVariantId" = pv.id
            INNER JOIN "Products" p ON pv."productId" = p.id
            INNER JOIN "Branch" b ON o."branchId" = b.id
            LEFT JOIN "Stocks" st
                ON st."productVariantId" = pv.id
                AND st."branchId" = o."branchId"
            WHERE 1=1
                AND oi."ItemType" = 'PRODUCT'
                AND o.status IN ('APPROVED', 'COMPLETED')
                ${branchRestriction}
                ${dateFilter}
            GROUP BY
                pv.id,
                p.id,
                p.name,
                pv.name,
                pv.sku,
                pv.barcode,
                pv."stockAlert",
                b.id
            ORDER BY
                COALESCE(SUM(COALESCE(oi."baseQty", oi.quantity, 0)), 0) DESC,
                COALESCE(SUM(oi.total), 0) DESC
            LIMIT ${limit}
        `);

        const safeData = data.map((item: any, index: number) => ({
            rank: index + 1,
            productVariantId: Number(item.productVariantId),
            productId: Number(item.productId),
            productName: item.productName,
            variantName: item.variantName,
            sku: item.sku,
            barcode: item.barcode,
            totalQty: Number(item.totalQty || 0),
            totalRevenue: Number(item.totalRevenue || 0),
            currentStock: Number(item.currentStock || 0),
            stockAlert: Number(item.stockAlert || 0),
            branch: item.branch,
        }));

        res.status(200).json({
            data: safeData,
            total: safeData.length,
        });
    } catch (error) {
        console.error("Dashboard top selling products error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const getDashboardLowStockProducts = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
        const branchId = req.query.branchId
        ? parseInt(req.query.branchId as string, 10)
        : null;

        const threshold = req.query.threshold
        ? parseInt(req.query.threshold as string, 10)
        : 5;

        const loggedInUser = req.user;

        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        const isAdmin = loggedInUser.roleType === "ADMIN";
        const effectiveBranchId = isAdmin ? branchId : loggedInUser.branchId;

        if (!isAdmin && !loggedInUser.branchId) {
            res.status(403).json({ message: "Branch not assigned." });
            return;
        }

        let data: any[] = [];
        let mode: "branch" | "all" = "all";

        // ==============================
        // BRANCH MODE
        // ==============================
        if (effectiveBranchId) {
            mode = "branch";

            data = await prisma.$queryRawUnsafe(`
                SELECT
                pv.id AS "productVariantId",
                p.id AS "productId",
                p.name AS "productName",
                pv.name AS "variantName",
                pv.sku AS "sku",
                pv.barcode AS "barcode",
                COALESCE(s.quantity, 0) AS "currentStock",
                json_build_object(
                    'id', b.id,
                    'name', b.name
                ) AS branch
                FROM "Stocks" s
                INNER JOIN "ProductVariants" pv
                ON s."productVariantId" = pv.id
                INNER JOIN "Products" p
                ON pv."productId" = p.id
                INNER JOIN "Branch" b
                ON s."branchId" = b.id
                WHERE 1=1
                AND s."branchId" = ${effectiveBranchId}
                AND pv."isActive" = 1
                AND COALESCE(s.quantity, 0) <= ${threshold}
                ORDER BY
                COALESCE(s.quantity, 0) ASC,
                p.name ASC,
                pv.name ASC
                LIMIT ${limit}
            `);
        } else {
            // ==============================
            // ALL BRANCHES MODE
            // ==============================
            mode = "all";

            data = await prisma.$queryRawUnsafe(`
                SELECT
                pv.id AS "productVariantId",
                p.id AS "productId",
                p.name AS "productName",
                pv.name AS "variantName",
                pv.sku AS "sku",
                pv.barcode AS "barcode",
                COALESCE(SUM(s.quantity), 0) AS "currentStock"
                FROM "Stocks" s
                INNER JOIN "ProductVariants" pv
                ON s."productVariantId" = pv.id
                INNER JOIN "Products" p
                ON pv."productId" = p.id
                WHERE 1=1
                AND pv."isActive" = 1
                GROUP BY
                pv.id,
                p.id,
                p.name,
                pv.name,
                pv.sku,
                pv.barcode
                HAVING COALESCE(SUM(s.quantity), 0) <= ${threshold}
                ORDER BY
                COALESCE(SUM(s.quantity), 0) ASC,
                p.name ASC,
                pv.name ASC
                LIMIT ${limit}
            `);
        }

        const safeData = data.map((item: any) => {
            const currentStock = Number(item.currentStock || 0);

            return {
                productVariantId: Number(item.productVariantId),
                productId: Number(item.productId),
                productName: item.productName,
                variantName: item.variantName,
                sku: item.sku,
                barcode: item.barcode,
                currentStock,
                branch: item.branch || null,
                stockStatus: currentStock <= 0 ? "OUT_OF_STOCK" : "LOW_STOCK",
            };
        });

        res.status(200).json({
            data: safeData,
            total: safeData.length,
            mode,
            threshold,
        });
    } catch (error) {
        console.error("Dashboard low stock products error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const profitReport = async (req: Request, res: Response) => {
    try {
        const loggedInUser = req.user;

        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const startDate = getQueryString(req.query.startDate, "")!.trim();
        const endDate = getQueryString(req.query.endDate, "")!.trim();
        const branchId = getQueryNumber(req.query.branchId);

        const sortField = getQueryString(req.query.sortField, "orderDate")!;
        const sortOrder =
        getQueryString(req.query.sortOrder)?.toLowerCase() === "asc"
            ? "asc"
            : "desc";

        const offset = (pageNumber - 1) * pageSize;
        const likeTerm = `%${searchTerm}%`;

        /* ------------------------ */
        /* BRANCH RESTRICTION       */
        /* ------------------------ */
        let branchRestriction = "";
        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) {
                branchRestriction = `AND o."branchId" = ${Number(branchId)}`;
            }
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }

            branchRestriction = `
                AND o."branchId" = ${Number(loggedInUser.branchId)}
                AND o."createdBy" = ${Number(loggedInUser.id)}
            `;
        }

        let dateCondition = "";
        if (startDate) {
            dateCondition += ` AND o."orderDate" >= '${startDate}'::date`;
        }
        if (endDate) {
            dateCondition += ` AND o."orderDate" <= '${endDate}'::date`;
        }

        const SORT_FIELD_MAP: Record<string, string> = {
            orderDate: `o."orderDate"`,
            ref: `o.ref`,
            customerName: `COALESCE(c.name, '')`,
            branchName: `b.name`,
            totalSales: `COALESCE(o."totalAmount", 0)`,
            totalCogs: `COALESCE(SUM(COALESCE(oi.cogs, 0)), 0)`,
            grossProfit: `(COALESCE(o."totalAmount", 0) - COALESCE(SUM(COALESCE(oi.cogs, 0)), 0))`,
            marginPercent: `
                CASE
                WHEN COALESCE(o."totalAmount", 0) = 0 THEN 0
                ELSE ((COALESCE(o."totalAmount", 0) - COALESCE(SUM(COALESCE(oi.cogs, 0)), 0)) / COALESCE(o."totalAmount", 0)) * 100
                END
            `,
        };

        const sortColumn = SORT_FIELD_MAP[sortField] || `o."orderDate"`;

        const totalResult: any[] = await prisma.$queryRawUnsafe(
            `
                SELECT COUNT(*) AS total
                FROM (
                    SELECT o.id
                    FROM "Order" o
                    LEFT JOIN "Customer" c ON o."customerId" = c.id
                    JOIN "Branch" b ON o."branchId" = b.id
                    LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
                    WHERE o."deletedAt" IS NULL
                    AND o.status IN ('APPROVED', 'COMPLETED')
                    AND (
                        o.ref ILIKE $1
                        OR COALESCE(c.name, '') ILIKE $1
                        OR b.name ILIKE $1
                    )
                    ${branchRestriction}
                    ${dateCondition}
                    GROUP BY o.id
                ) t
            `,
            likeTerm
        );

        const total = Number(totalResult[0]?.total || 0);

        const rows: any[] = await prisma.$queryRawUnsafe(
            `
                SELECT
                    o.id AS "orderId",
                    o.ref,
                    o."orderDate",

                    c.id AS "customerId",
                    c.name AS "customerName",

                    b.id AS "branchId",
                    b.name AS "branchName",

                    COALESCE(o."totalAmount", 0)::FLOAT AS "totalSales",
                    COALESCE(SUM(COALESCE(oi.cogs, 0)), 0)::FLOAT AS "totalCogs",

                    (COALESCE(o."totalAmount", 0) - COALESCE(SUM(COALESCE(oi.cogs, 0)), 0))::FLOAT AS "grossProfit",

                    CASE
                    WHEN COALESCE(o."totalAmount", 0) = 0 THEN 0
                    ELSE (((COALESCE(o."totalAmount", 0) - COALESCE(SUM(COALESCE(oi.cogs, 0)), 0)) / COALESCE(o."totalAmount", 0)) * 100)
                    END::FLOAT AS "marginPercent",

                    u.id AS "createdById",
                    (u."firstName" || ' ' || u."lastName") AS "createdByName"

                FROM "Order" o
                LEFT JOIN "Customer" c ON o."customerId" = c.id
                JOIN "Branch" b ON o."branchId" = b.id
                LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
                LEFT JOIN "User" u ON o."createdBy" = u.id

                WHERE o."deletedAt" IS NULL
                    AND o.status IN ('APPROVED', 'COMPLETED')
                    AND (
                    o.ref ILIKE $1
                    OR COALESCE(c.name, '') ILIKE $1
                    OR b.name ILIKE $1
                    )
                    ${branchRestriction}
                    ${dateCondition}

                GROUP BY
                    o.id,
                    o.ref,
                    o."orderDate",
                    c.id,
                    c.name,
                    b.id,
                    b.name,
                    u.id,
                    u."firstName",
                    u."lastName"

                ORDER BY ${sortColumn} ${sortOrder}
                LIMIT $2 OFFSET $3
            `,
            likeTerm,
            pageSize,
            offset
        );

        const data = rows.map((r) => ({
            orderId: r.orderId,
            ref: r.ref,
            orderDate: r.orderDate,
            customerId: r.customerId,
            customerName: r.customerName,
            branchId: r.branchId,
            branchName: r.branchName,
            totalSales: Number(r.totalSales || 0),
            totalCogs: Number(r.totalCogs || 0),
            grossProfit: Number(r.grossProfit || 0),
            marginPercent: Number(r.marginPercent || 0),
            createdBy: r.createdById
                ? { id: r.createdById, name: r.createdByName }
                : null,
        }));

        const summary = data.reduce(
            (acc, item) => {
                acc.totalSales += item.totalSales;
                acc.totalCogs += item.totalCogs;
                acc.totalProfit += item.grossProfit;
                return acc;
            },
            {
                totalSales: 0,
                totalCogs: 0,
                totalProfit: 0,
            }
        );

        const avgMarginPercent =
            summary.totalSales > 0
                ? (summary.totalProfit / summary.totalSales) * 100
                : 0;

        res.json({
            data,
            summary: {
                totalSales: Number(summary.totalSales.toFixed(2)),
                totalCogs: Number(summary.totalCogs.toFixed(2)),
                totalProfit: Number(summary.totalProfit.toFixed(2)),
                avgMarginPercent: Number(avgMarginPercent.toFixed(2)),
            },
            pagination: {
                total,
                page: pageNumber,
                pageSize,
                totalPages: Math.ceil(total / pageSize),
            },
        });
    } catch (error) {
        console.error("profitReport error:", error);
        res.status(500).json({ message: "Failed to load profit report" });
    }
};
