import { Request, Response } from "express";
import { ItemType, PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { getQueryNumber, getQueryString } from "../utils/request";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

const prisma = new PrismaClient();

export const getAllReportInvoices = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        /* ------------------------ */
        /* PAGINATION & FILTERS    */
        /* ------------------------ */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "ref")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";

        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const saleType = req.query.saleType as string | undefined;
        const status = req.query.status as string | undefined;
        const branchId = req.query.branchId
            ? parseInt(req.query.branchId as string, 10)
            : null;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        /* ------------------------ */
        /* SEARCH SETUP            */
        /* ------------------------ */
        const likeTerm = `%${searchTerm}%`;
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        const fullNameConditions = searchWords
            .map((_, idx) => `(
                c."firstName" ILIKE $${idx + 2}
                OR c."lastName" ILIKE $${idx + 2}
                OR u."firstName" ILIKE $${idx + 2}
                OR u."lastName" ILIKE $${idx + 2}
                OR cs."name" ILIKE $${idx + 2}
                OR br."name" ILIKE $${idx + 2}
            )`).join(" AND ");

        const params: any[] = [likeTerm, ...searchWords.map(w => `%${w}%`)];

        /* ------------------------ */
        /* BRANCH RESTRICTION       */
        /* ------------------------ */
        let branchRestriction = "";
        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) branchRestriction = `AND rd."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `
                AND rd."branchId" = ${loggedInUser.branchId}
                AND rd."createdBy" = ${loggedInUser.id}
            `;
        }

        /* ------------------------ */
        /* COMMON FILTERS           */
        /* ------------------------ */
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            AND rd."status" IN ('APPROVED', 'COMPLETED')
            ${startDate && endDate ? `AND rd."orderDate"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            ${saleType ? `AND rd."OrderSaleType" = '${saleType}'` : ""}
            ${status ? `AND rd."status" = '${status}'` : ""}
            AND (
                rd."ref" ILIKE $1
                OR cs."name" ILIKE $1
                OR br."name" ILIKE $1
                OR TO_CHAR(rd."orderDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* ------------------------ */
        /* SUMMARY TOTALS (Profit) */
        /* ------------------------ */
        const summary: any = await prisma.$queryRawUnsafe(`
            WITH filtered_orders AS (
                SELECT rd.id, rd."totalAmount", rd."paidAmount"
                FROM "Order" rd
                LEFT JOIN "Customer" cs ON rd."customerId" = cs.id
                LEFT JOIN "Branch" br ON rd."branchId" = br.id
                LEFT JOIN "User" c ON rd."createdBy" = c.id
                LEFT JOIN "User" u ON rd."updatedBy" = u.id
                ${commonFilters}
                GROUP BY rd.id
            ),
            profit_calc AS (
                SELECT
                    rd.id AS "orderId",
                    SUM(
                        CASE
                            WHEN sm.type = 'ORDER' THEN
                                ABS(sm.quantity) * (oi.price - sm."unitCost")
                            WHEN sm.type = 'SALE_RETURN' THEN
                                -ABS(sm.quantity) * (oi.price - sm."unitCost")
                            ELSE 0
                        END
                    ) AS profit
                FROM "Order" rd
                JOIN "OrderItem" oi
                    ON oi."orderId" = rd.id
                    AND oi."ItemType" = 'PRODUCT'
                JOIN "StockMovements" sm
                    ON sm."orderItemId" = oi.id
                    AND sm.status = 'APPROVED'
                    AND sm.type IN ('ORDER', 'SALE_RETURN')
                GROUP BY rd.id
            )
            SELECT
                COUNT(fo.id) AS "totalInvoice",
                COALESCE(SUM(fo."totalAmount"), 0) AS "totalAmount",
                COALESCE(SUM(fo."paidAmount"), 0) AS "totalReceivedAmount",
                COALESCE(SUM(fo."totalAmount" - fo."paidAmount"), 0) AS "totalRemainAmount",
                COALESCE(SUM(pc.profit), 0) AS "totalProfit"
            FROM filtered_orders fo
            LEFT JOIN profit_calc pc ON pc."orderId" = fo.id
        `, ...params);

        const summarySafe = {
            totalInvoice: Number(summary[0]?.totalInvoice || 0),
            totalAmount: Number(summary[0]?.totalAmount || 0),
            totalReceivedAmount: Number(summary[0]?.totalReceivedAmount || 0),
            totalRemainAmount: Number(summary[0]?.totalRemainAmount || 0),
            totalProfit: Number(summary[0]?.totalProfit || 0),
        };

        /* ------------------------ */
        /* TOTAL COUNT FOR PAGINATION */
        /* ------------------------ */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT rd.id
                FROM "Order" rd
                LEFT JOIN "Customer" cs ON rd."customerId" = cs.id
                LEFT JOIN "Branch" br ON rd."branchId" = br.id
                LEFT JOIN "User" c ON rd."createdBy" = c.id
                LEFT JOIN "User" u ON rd."updatedBy" = u.id
                ${commonFilters}
                GROUP BY rd.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* ------------------------ */
        /* FETCH DATA LIST          */
        /* ------------------------ */
        const invoices: any = await prisma.$queryRawUnsafe(`
            SELECT rd.*,
                json_build_object('id', cs.id, 'name', cs.name) AS customer,
                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                json_build_object('id', ab.id, 'firstName', ab."firstName", 'lastName', ab."lastName") AS approver,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
            FROM "Order" rd
            LEFT JOIN "Customer" cs ON rd."customerId" = cs.id
            LEFT JOIN "Branch" br ON rd."branchId" = br.id
            LEFT JOIN "User" c ON rd."createdBy" = c.id
            LEFT JOIN "User" u ON rd."updatedBy" = u.id
            LEFT JOIN "User" ab ON rd."approvedBy" = ab.id
            LEFT JOIN "User" db ON rd."deletedBy" = db.id
            ${commonFilters}
            ORDER BY rd."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const invoicesSafe = invoices.map((inv: any) => ({
            ...inv,
            id: Number(inv.id),
            branchId: Number(inv.branchId),
            customerId: inv.customerId ? Number(inv.customerId) : null,
            createdBy: inv.createdBy ? Number(inv.createdBy) : null,
            updatedBy: inv.updatedBy ? Number(inv.updatedBy) : null,
            approvedBy: inv.approvedBy ? Number(inv.approvedBy) : null,
            deletedBy: inv.deletedBy ? Number(inv.deletedBy) : null,
            totalAmount: Number(inv.totalAmount),
            paidAmount: Number(inv.paidAmount),
            grandTotal: Number(inv.totalAmount),
        }));

        res.status(200).json({
            data: invoicesSafe,
            total,
            summary: summarySafe,
        });

        // console.log("Data: ", summarySafe);

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
        /* -------------------------------------------------- */
        /* PAGINATION & FILTER PARAMS                         */
        /* -------------------------------------------------- */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "ref")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";

        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const saleType = req.query.saleType as string | undefined;
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
                    c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR cs."name" ILIKE $${idx + 2}
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
            if (branchId) branchRestriction = `AND rd."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND rd."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------------------------------------- */
        /* COMMON FILTERS                                     */
        /* -------------------------------------------------- */
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            AND rd."status" = 'CANCELLED'
            ${startDate && endDate ? `AND rd."deletedAt"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            ${saleType ? `AND rd."OrderSaleType" = '${saleType}'` : ""}
            ${status ? `AND rd."status" = '${status}'` : ""}
            AND (
                rd."ref" ILIKE $1
                OR cs."name" ILIKE $1
                OR br."name" ILIKE $1
                OR TO_CHAR(rd."orderDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."orderDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------------------------------------- */
        /* 1️ SUMMARY TOTALS                                   */
        /* -------------------------------------------------- */
        const summary: any = await prisma.$queryRawUnsafe(`
            SELECT
                COUNT(DISTINCT rd.id) AS "totalInvoice",
                COALESCE(SUM(rd."totalAmount"), 0) AS "totalAmount",
                COALESCE(SUM(rd."paidAmount"), 0) AS "totalReceivedAmount",
                COALESCE(SUM(rd."totalAmount" - rd."paidAmount"), 0) AS "totalRemainAmount",
                COALESCE(SUM(order_profit), 0) AS "totalProfit"
            FROM "Order" rd
            LEFT JOIN (
                SELECT oi."orderId",
                    SUM(
                        CASE
                            WHEN oi."ItemType" = 'PRODUCT'
                            THEN (oi.price - COALESCE(pv."purchasePrice", 0)) * oi.quantity
                            ELSE 0
                        END
                    ) AS order_profit
                FROM "OrderItem" oi
                LEFT JOIN "ProductVariants" pv ON pv.id = oi."productVariantId"
                GROUP BY oi."orderId"
            ) AS profits ON profits."orderId" = rd.id
            LEFT JOIN "Customer" cs ON rd."customerId" = cs.id
            LEFT JOIN "Branch" br ON rd."branchId" = br.id
            LEFT JOIN "User" c ON rd."createdBy" = c.id
            LEFT JOIN "User" u ON rd."updatedBy" = u.id
            LEFT JOIN "User" ab ON rd."approvedBy" = ab.id
            LEFT JOIN "User" db ON rd."deletedBy" = db.id
            ${commonFilters}
        `, ...params);

        /* Convert BigInt in summary */
        const summarySafe = {
            totalInvoice: Number(summary[0]?.totalInvoice || 0),
            totalAmount: Number(summary[0]?.totalAmount || 0),
            totalReceivedAmount: Number(summary[0]?.totalReceivedAmount || 0),
            totalRemainAmount: Number(summary[0]?.totalRemainAmount || 0),
            totalProfit: Number(summary[0]?.totalProfit || 0),
        };

        /* -------------------------------------------------- */
        /* 2️ TOTAL COUNT (PAGINATION)                       */
        /* -------------------------------------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT rd.id
                FROM "Order" rd
                LEFT JOIN "Customer" cs ON rd."customerId" = cs.id
                LEFT JOIN "Branch" br ON rd."branchId" = br.id
                LEFT JOIN "User" c ON rd."createdBy" = c.id
                LEFT JOIN "User" u ON rd."updatedBy" = u.id
                ${commonFilters}
                GROUP BY rd.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------------------------------------- */
        /* 3️ DATA LIST                                      */
        /* -------------------------------------------------- */
        const invoices: any = await prisma.$queryRawUnsafe(`
            SELECT rd.*,
                json_build_object('id', cs.id, 'name', cs.name) AS customer,
                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                json_build_object('id', ab.id, 'firstName', ab."firstName", 'lastName', ab."lastName") AS approver,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
            FROM "Order" rd
            LEFT JOIN "Customer" cs ON rd."customerId" = cs.id
            LEFT JOIN "Branch" br ON rd."branchId" = br.id
            LEFT JOIN "User" c ON rd."createdBy" = c.id
            LEFT JOIN "User" u ON rd."updatedBy" = u.id
            LEFT JOIN "User" ab ON rd."approvedBy" = ab.id
            LEFT JOIN "User" db ON rd."deletedBy" = db.id
            ${commonFilters}
            ORDER BY rd."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const invoicesSafe = invoices.map((inv: any) => ({
            ...inv,
            id: Number(inv.id),
            branchId: Number(inv.branchId),
            customerId: inv.customerId ? Number(inv.customerId) : null,
            createdBy: inv.createdBy ? Number(inv.createdBy) : null,
            updatedBy: inv.updatedBy ? Number(inv.updatedBy) : null,
            approvedBy: inv.approvedBy ? Number(inv.approvedBy) : null,
            deletedBy: inv.deletedBy ? Number(inv.deletedBy) : null,
            totalAmount: Number(inv.totalAmount),
            paidAmount: Number(inv.paidAmount),
            grandTotal: Number(inv.totalAmount),
        }));

        // console.log("Data: ", invoicesSafe);
        // console.log("Summary: ", summarySafe);

        res.status(200).json({
            data: invoicesSafe,
            total,
            summary: summarySafe,
        });

    } catch (error) {
        console.error("Report invoice error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const getAllPaymentInvoices = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        /* -------------------- Pagination -------------------- */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "paymentDate")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";

        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const saleType = req.query.saleType as string | undefined;
        const status = req.query.status as string | undefined;
        const branchId = req.query.branchId
            ? parseInt(req.query.branchId as string, 10)
            : undefined;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        /* -------------------- Search Setup -------------------- */
        const likeTerm = `%${searchTerm}%`;
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        const fullNameConditions = searchWords
            .map(
                (_, idx) => `
                (
                    c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR cs."name" ILIKE $${idx + 2}
                    OR br."name" ILIKE $${idx + 2}
                )
            `
            )
            .join(" AND ");

        const params: any[] = [likeTerm, ...searchWords.map(w => `%${w}%`)];

        /* -------------------- Branch Restriction -------------------- */
        let branchRestriction = "";
        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) {
                branchRestriction = `AND op."branchId" = ${branchId}`;
            }
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND op."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------- Date Filter (PAYMENT DATE) -------------------- */
        const dateFilter =
            startDate && endDate
                ? `AND op."paymentDate"::date BETWEEN '${startDate}' AND '${endDate}'`
                : `AND op."paymentDate"::date = CURRENT_DATE`;

        /* -------------------- Common Filters -------------------- */
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${saleType ? `AND op."OrderSaleType" = '${saleType}'` : ""}
            ${status ? `AND op."status" = '${status}'` : ""}
            ${dateFilter}
            AND (
                o."ref" ILIKE $1
                OR cs."name" ILIKE $1
                OR br."name" ILIKE $1
                OR TO_CHAR(op."paymentDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."paymentDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------- Summary (PAYMENT BASED) -------------------- */
        const summaryResult: any = await prisma.$queryRawUnsafe(
            `
            SELECT
                COUNT(op.id) AS "totalPayments",
                COALESCE(SUM(op."totalPaid"), 0) AS "totalPaid"
            FROM "OrderOnPayments" op
            LEFT JOIN "Order" o ON op."orderId" = o.id
            LEFT JOIN "Customer" cs ON o."customerId" = cs.id
            LEFT JOIN "Branch" br ON o."branchId" = br.id
            LEFT JOIN "User" c ON op."createdBy" = c.id
            LEFT JOIN "User" db ON op."deletedBy" = db.id
            ${commonFilters}
            `,
            ...params
        );

        const summary = {
            totalPayments: Number(summaryResult[0]?.totalPayments || 0),
            totalPaid: Number(summaryResult[0]?.totalPaid || 0),
        };

        /* -------------------- Total Count (Pagination) -------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(
            `
            SELECT COUNT(*) AS total
            FROM "OrderOnPayments" op
            LEFT JOIN "Order" o ON op."orderId" = o.id
            LEFT JOIN "Customer" cs ON o."customerId" = cs.id
            LEFT JOIN "Branch" br ON o."branchId" = br.id
            LEFT JOIN "User" c ON op."createdBy" = c.id
            LEFT JOIN "User" db ON op."deletedBy" = db.id
            ${commonFilters}
            `,
            ...params
        );

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------- Safe Sorting -------------------- */
        const allowedSortFields = [
            "paymentDate",
            "totalPaid",
            "createdAt",
            "deletedAt"
        ];
        const safeSortField = allowedSortFields.includes(sortField)
            ? sortField
            : "paymentDate";

        /* -------------------- Data List -------------------- */
        const payments: any = await prisma.$queryRawUnsafe(
            `
            SELECT
                op.*,
                json_build_object(
                    'id', o.id,
                    'ref', o."ref",
                    'customerId', o."customerId",
                    'orderDate', o."orderDate",
                    'OrderSaleType', o."OrderSaleType",
                    'status', o."status",
                    'totalAmount', o."totalAmount",
                    'paidAmount', o."paidAmount"
                ) AS "order",
                json_build_object(
                    'id', pm.id,
                    'name', pm."name"
                ) AS "PaymentMethods",
                json_build_object('id', cs.id, 'name', cs.name) AS customer,
                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
            FROM "OrderOnPayments" op
            LEFT JOIN "Order" o ON op."orderId" = o.id
            LEFT JOIN "Customer" cs ON o."customerId" = cs.id
            LEFT JOIN "PaymentMethods" pm ON op."paymentMethodId" = pm.id
            LEFT JOIN "Branch" br ON o."branchId" = br.id
            LEFT JOIN "User" c ON op."createdBy" = c.id
            LEFT JOIN "User" db ON op."deletedBy" = db.id
            ${commonFilters}
            ORDER BY op."${safeSortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
            `,
            ...params
        );

        const paymentsSafe = payments.map((p: any) => ({
            ...p,
            id: Number(p.id),
            orderId: Number(p.orderId),
            branchId: Number(p.branchId),
            totalPaid: Number(p.totalPaid),
            createdBy: p.createdBy ? Number(p.createdBy) : null,
            updatedBy: p.updatedBy ? Number(p.updatedBy) : null,
        }));

        // console.log("Data: ", paymentsSafe);
        // console.log("Summary: ", summary);


        /* -------------------- Response -------------------- */
        res.status(200).json({
            data: paymentsSafe,
            total,
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
        /* -------------------------------------------------- */
        /* PAGINATION & FILTER PARAMS                         */
        /* -------------------------------------------------- */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "ref")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";

        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const saleType = req.query.saleType as string | undefined;
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
                    c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR cs."name" ILIKE $${idx + 2}
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
            if (branchId) branchRestriction = `AND qt."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND qt."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------------------------------------- */
        /* COMMON FILTERS                                     */
        /* -------------------------------------------------- */
        
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${startDate && endDate ? `AND qt."quotationDate"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            ${saleType ? `AND qt."QuoteSaleType" = '${saleType}'` : ""}
            ${status ? `AND qt."status" = '${status}'` : ""}
            AND (
                qt."ref" ILIKE $1
                OR cs."name" ILIKE $1
                OR br."name" ILIKE $1
                OR TO_CHAR(qt."quotationDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(qt."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(qt."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(qt."invoicedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(qt."sentAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(qt."quotationDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(qt."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(qt."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(qt."invoicedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(qt."sentAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------------------------------------- */
        /* 1️ SUMMARY TOTALS                                   */
        /* -------------------------------------------------- */
        const summary: any = await prisma.$queryRawUnsafe(`
            SELECT
                COUNT(DISTINCT qt.id) AS "totalQuotation",
                COALESCE(SUM(qt."grandTotal"), 0) AS "totalAmount"
            FROM "Quotations" qt
            LEFT JOIN "Customer" cs ON qt."customerId" = cs.id
            LEFT JOIN "Branch" br ON qt."branchId" = br.id
            LEFT JOIN "User" c ON qt."createdBy" = c.id
            LEFT JOIN "User" u ON qt."updatedBy" = u.id
            LEFT JOIN "User" sb ON qt."sentBy" = sb.id
            LEFT JOIN "User" inb ON qt."invoicedBy" = inb.id
            LEFT JOIN "User" db ON qt."deletedBy" = db.id
            ${commonFilters}
        `, ...params);

        /* Convert BigInt in summary */
        const summarySafe = {
            totalQuotation: Number(summary[0]?.totalQuotation || 0),
            totalAmount: Number(summary[0]?.totalAmount || 0)
        };

        /* -------------------------------------------------- */
        /* 2️ TOTAL COUNT (PAGINATION)                       */
        /* -------------------------------------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT qt.id
                FROM "Quotations" qt
                LEFT JOIN "Customer" cs ON qt."customerId" = cs.id
                LEFT JOIN "Branch" br ON qt."branchId" = br.id
                LEFT JOIN "User" c ON qt."createdBy" = c.id
                LEFT JOIN "User" u ON qt."updatedBy" = u.id
                LEFT JOIN "User" sb ON qt."sentBy" = sb.id
                LEFT JOIN "User" inb ON qt."invoicedBy" = inb.id
                LEFT JOIN "User" db ON qt."deletedBy" = db.id
                ${commonFilters}
                GROUP BY qt.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------------------------------------- */
        /* 3️ DATA LIST                                      */
        /* -------------------------------------------------- */
        const quotations: any = await prisma.$queryRawUnsafe(`
            SELECT qt.*,
                json_build_object('id', cs.id, 'name', cs.name) AS customer,
                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                json_build_object('id', sb.id, 'firstName', sb."firstName", 'lastName', sb."lastName") AS sender,
                json_build_object('id', inb.id, 'firstName', inb."firstName", 'lastName', inb."lastName") AS invoicer,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
            FROM "Quotations" qt
            LEFT JOIN "Customer" cs ON qt."customerId" = cs.id
            LEFT JOIN "Branch" br ON qt."branchId" = br.id
            LEFT JOIN "User" c ON qt."createdBy" = c.id
            LEFT JOIN "User" u ON qt."updatedBy" = u.id
            LEFT JOIN "User" sb ON qt."sentBy" = sb.id
            LEFT JOIN "User" inb ON qt."invoicedBy" = inb.id
            LEFT JOIN "User" db ON qt."deletedBy" = db.id
            ${commonFilters}
            ORDER BY qt."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const quotationsSafe = quotations.map((quote: any) => ({
            ...quote,
            id: Number(quote.id),
            branchId: Number(quote.branchId),
            customerId: quote.customerId ? Number(quote.customerId) : null,
            createdBy: quote.createdBy ? Number(quote.createdBy) : null,
            updatedBy: quote.updatedBy ? Number(quote.updatedBy) : null,
            invoicedBy: quote.invoicedBy ? Number(quote.invoicedBy) : null,
            sentBy: quote.sentBy ? Number(quote.sentBy) : null,
            deletedBy: quote.deletedBy ? Number(quote.deletedBy) : null
        }));

        res.status(200).json({
            data: quotationsSafe,
            total,
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
        /* -------------------------------------------------- */
        /* PAGINATION & FILTER PARAMS                         */
        /* -------------------------------------------------- */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "ref")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";

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
                    c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR s."name" ILIKE $${idx + 2}
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
            if (branchId) branchRestriction = `AND pc."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND pc."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------------------------------------- */
        /* COMMON FILTERS                                     */
        /* -------------------------------------------------- */
        
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${startDate && endDate ? `AND pc."purchaseDate"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            ${status ? `AND pc."status" = '${status}'` : ""}
            AND (
                pc."ref" ILIKE $1
                OR s."name" ILIKE $1
                OR br."name" ILIKE $1
                OR TO_CHAR(pc."purchaseDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(pc."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(pc."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(pc."receivedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(pc."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(pc."purchaseDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(pc."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(pc."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(pc."receivedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(pc."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------------------------------------- */
        /* 1️ SUMMARY TOTALS                                   */
        /* -------------------------------------------------- */
        const summary: any = await prisma.$queryRawUnsafe(`
            SELECT
                COUNT(DISTINCT pc.id) AS "totalPurchase",
                COALESCE(SUM(pc."grandTotal"), 0) AS "grandTotalAmount",
                COALESCE(SUM(pc."paidAmount"), 0) AS "totalPaidAmount",
                COALESCE(SUM(pc."grandTotal" - pc."paidAmount"), 0) AS "totalRemainAmount"
            FROM "Purchases" pc
            LEFT JOIN "Suppliers" s ON pc."supplierId" = s.id
            LEFT JOIN "Branch" br ON pc."branchId" = br.id
            LEFT JOIN "User" c ON pc."createdBy" = c.id
            LEFT JOIN "User" u ON pc."updatedBy" = u.id
            LEFT JOIN "User" rcb ON pc."receivedBy" = rcb.id
            LEFT JOIN "User" db ON pc."deletedBy" = db.id
            ${commonFilters}
        `, ...params);

        /* Convert BigInt in summary */
        const summarySafe = {
            totalPurchase: Number(summary[0]?.totalPurchase || 0),
            grandTotalAmount: Number(summary[0]?.grandTotalAmount || 0),
            totalPaidAmount: Number(summary[0]?.totalPaidAmount || 0),
            totalRemainAmount: Number(summary[0]?.totalRemainAmount || 0)
        };

        /* -------------------------------------------------- */
        /* 2️ TOTAL COUNT (PAGINATION)                       */
        /* -------------------------------------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT pc.id
                FROM "Purchases" pc
                LEFT JOIN "Suppliers" s ON pc."supplierId" = s.id
                LEFT JOIN "Branch" br ON pc."branchId" = br.id
                LEFT JOIN "User" c ON pc."createdBy" = c.id
                LEFT JOIN "User" u ON pc."updatedBy" = u.id
                LEFT JOIN "User" rcb ON pc."receivedBy" = rcb.id
                LEFT JOIN "User" db ON pc."deletedBy" = db.id
                ${commonFilters}
                GROUP BY pc.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------------------------------------- */
        /* 3️ DATA LIST                                      */
        /* -------------------------------------------------- */
        const purchases: any = await prisma.$queryRawUnsafe(`
            SELECT pc.*,
                json_build_object('id', s.id, 'name', s.name) AS supplier,
                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                json_build_object('id', rcb.id, 'firstName', rcb."firstName", 'lastName', rcb."lastName") AS receiver,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
            FROM "Purchases" pc
            LEFT JOIN "Suppliers" s ON pc."supplierId" = s.id
            LEFT JOIN "Branch" br ON pc."branchId" = br.id
            LEFT JOIN "User" c ON pc."createdBy" = c.id
            LEFT JOIN "User" u ON pc."updatedBy" = u.id
            LEFT JOIN "User" rcb ON pc."receivedBy" = rcb.id
            LEFT JOIN "User" db ON pc."deletedBy" = db.id
            ${commonFilters}
            ORDER BY pc."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const purchaseSafe = purchases.map((quote: any) => ({
            ...quote,
            id: Number(quote.id),
            branchId: Number(quote.branchId),
            supplierId: quote.supplierId ? Number(quote.supplierId) : null,
            createdBy: quote.createdBy ? Number(quote.createdBy) : null,
            updatedBy: quote.updatedBy ? Number(quote.updatedBy) : null,
            receivedBy: quote.receivedBy ? Number(quote.receivedBy) : null,
            deletedBy: quote.deletedBy ? Number(quote.deletedBy) : null
        }));
        // console.log("Data: ", purchaseSafe);
        // console.log("Summary: ", summarySafe);

        res.status(200).json({
            data: purchaseSafe,
            total,
            summary: summarySafe,
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
        /* -------------------- Pagination -------------------- */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "paymentDate")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "desc" : "asc";

        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const saleType = req.query.saleType as string | undefined;
        const status = req.query.status as string | undefined;
        const branchId = req.query.branchId
            ? parseInt(req.query.branchId as string, 10)
            : undefined;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        /* -------------------- Search Setup -------------------- */
        const likeTerm = `%${searchTerm}%`;
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        const fullNameConditions = searchWords
            .map(
                (_, idx) => `
                (
                    c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR cs."name" ILIKE $${idx + 2}
                    OR br."name" ILIKE $${idx + 2}
                )
            `
            )
            .join(" AND ");

        const params: any[] = [likeTerm, ...searchWords.map(w => `%${w}%`)];

        /* -------------------- Branch Restriction -------------------- */
        let branchRestriction = "";
        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) {
                branchRestriction = `AND op."branchId" = ${branchId}`;
            }
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND op."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------- Date Filter (PAYMENT DATE) -------------------- */
        const dateFilter =
            startDate && endDate
                ? `AND op."paymentDate"::date BETWEEN '${startDate}' AND '${endDate}'`
                : `AND op."paymentDate"::date = CURRENT_DATE`;

        /* -------------------- Common Filters -------------------- */
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${saleType ? `AND op."OrderSaleType" = '${saleType}'` : ""}
            ${status ? `AND op."status" = '${status}'` : ""}
            ${dateFilter}
            AND (
                o."ref" ILIKE $1
                OR s."name" ILIKE $1
                OR br."name" ILIKE $1
                OR TO_CHAR(op."paymentDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."paymentDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------- Summary (PAYMENT BASED) -------------------- */
        const summaryResult: any = await prisma.$queryRawUnsafe(
            `
            SELECT
                COUNT(op.id) AS "totalPayments",
                COALESCE(SUM(op."amount"), 0) AS "totalPaid"
            FROM "PurchaseOnPayments" op
            LEFT JOIN "Purchases" o ON op."purchaseId" = o.id
            LEFT JOIN "Suppliers" s ON o."supplierId" = s.id
            LEFT JOIN "Branch" br ON o."branchId" = br.id
            LEFT JOIN "User" c ON op."createdBy" = c.id
            LEFT JOIN "User" db ON op."deletedBy" = db.id
            ${commonFilters}
            `,
            ...params
        );

        const summary = {
            totalPayments: Number(summaryResult[0]?.totalPayments || 0),
            totalPaid: Number(summaryResult[0]?.totalPaid || 0),
        };

        /* -------------------- Total Count (Pagination) -------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(
            `
            SELECT COUNT(*) AS total
            FROM "PurchaseOnPayments" op
            LEFT JOIN "Purchases" o ON op."purchaseId" = o.id
            LEFT JOIN "Suppliers" s ON o."supplierId" = s.id
            LEFT JOIN "Branch" br ON o."branchId" = br.id
            LEFT JOIN "User" c ON op."createdBy" = c.id
            LEFT JOIN "User" db ON op."deletedBy" = db.id
            ${commonFilters}
            `,
            ...params
        );

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------- Safe Sorting -------------------- */
        const allowedSortFields = [
            "paymentDate",
            "totalPaid",
            "createdAt",
            "deletedAt"
        ];
        const safeSortField = allowedSortFields.includes(sortField)
            ? sortField
            : "paymentDate";

        /* -------------------- Data List -------------------- */
        const payments: any = await prisma.$queryRawUnsafe(
            `
            SELECT
                op.*,
                json_build_object(
                    'id', o.id,
                    'ref', o."ref",
                    'purchaseDate', o."purchaseDate",
                    'status', o."status",
                    'totalAmount', o."grandTotal",
                    'paidAmount', o."paidAmount"
                ) AS "purchase",
                json_build_object(
                    'id', pm.id,
                    'name', pm."name"
                ) AS "PaymentMethods",
                json_build_object('id', s.id, 'name', s.name) AS supplier,
                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter
            FROM "PurchaseOnPayments" op
            LEFT JOIN "Purchases" o ON op."purchaseId" = o.id
            LEFT JOIN "Suppliers" s ON o."supplierId" = s.id
            LEFT JOIN "PaymentMethods" pm ON op."paymentMethodId" = pm.id
            LEFT JOIN "Branch" br ON o."branchId" = br.id
            LEFT JOIN "User" c ON op."createdBy" = c.id
            LEFT JOIN "User" db ON op."deletedBy" = db.id
            ${commonFilters}
            ORDER BY op."${safeSortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
            `,
            ...params
        );

        const paymentsSafe = payments.map((p: any) => ({
            ...p,
            id: Number(p.id),
            purchaseId: Number(p.purchaseId),
            branchId: Number(p.branchId),
            totalPaid: Number(p.totalPaid),
            createdBy: p.createdBy ? Number(p.createdBy) : null
        }));

        // console.log("Data: ", paymentsSafe);
        // console.log("Summary: ", summary);


        /* -------------------- Response -------------------- */
        res.status(200).json({
            data: paymentsSafe,
            total,
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
        /* -------------------------------------------------- */
        /* PAGINATION & FILTER PARAMS                         */
        /* -------------------------------------------------- */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "ref")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "desc" : "asc";

        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const adjustType = req.query.adjustType as string | undefined;
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
                    c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR ap."firstName" ILIKE $${idx + 2}
                    OR ap."lastName" ILIKE $${idx + 2}
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
            if (branchId) branchRestriction = `AND sam."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND sam."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------------------------------------- */
        /* COMMON FILTERS                                     */
        /* -------------------------------------------------- */
        
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${startDate && endDate ? `AND sam."adjustDate"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            ${adjustType ? `AND sam."AdjustMentType" = '${adjustType}'` : ""}
            ${status ? `AND sam."StatusType" = '${status}'` : ""}
            AND (
                br."name" ILIKE $1
                OR TO_CHAR(sam."adjustDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sam."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sam."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sam."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sam."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sam."adjustDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sam."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sam."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sam."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sam."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------------------------------------- */
        /* 21 TOTAL COUNT (PAGINATION)                       */
        /* -------------------------------------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT sam.id
                FROM "StockAdjustments" sam
                LEFT JOIN "Branch" br ON sam."branchId" = br.id
                LEFT JOIN "User" c ON sam."createdBy" = c.id
                LEFT JOIN "User" u ON sam."updatedBy" = u.id
                LEFT JOIN "User" ap ON sam."approvedBy" = ap.id
                LEFT JOIN "User" db ON sam."deletedBy" = db.id
                ${commonFilters}
                GROUP BY sam.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------------------------------------- */
        /* 3️ DATA LIST                                      */
        /* -------------------------------------------------- */
        const adjustments: any = await prisma.$queryRawUnsafe(`
            SELECT 
                sam.*,
                COALESCE(SUM(ad.quantity), 0) AS "totalQuantity",

                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                json_build_object('id', ap.id, 'firstName', ap."firstName", 'lastName', ap."lastName") AS approver,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter

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

            ORDER BY sam."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const adjustmentsSafe = adjustments.map((adj: any) => ({
            ...adj,
            id: Number(adj.id),
            branchId: Number(adj.branchId),
            totalQuantity: Number(adj.totalQuantity),
            createdBy: adj.createdBy ? Number(adj.createdBy) : null,
            updatedBy: adj.updatedBy ? Number(adj.updatedBy) : null,
            approvedBy: adj.approvedBy ? Number(adj.approvedBy) : null,
            deletedBy: adj.deletedBy ? Number(adj.deletedBy) : null
        }));

        // console.log("Data: ", adjustments);
        // console.log("Summary: ", summarySafe);

        res.status(200).json({
            data: adjustmentsSafe,
            total
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
        /* -------------------------------------------------- */
        /* PAGINATION & FILTER PARAMS                         */
        /* -------------------------------------------------- */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "ref")!;
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
                    c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR ap."firstName" ILIKE $${idx + 2}
                    OR ap."lastName" ILIKE $${idx + 2}
                    OR db."firstName" ILIKE $${idx + 2}
                    OR db."lastName" ILIKE $${idx + 2}
                    OR br."name" ILIKE $${idx + 2}
                    OR tbr."name" ILIKE $${idx + 2}
                )
            `)
            .join(" AND ");

        const params: any[] = [likeTerm, ...searchWords.map(w => `%${w}%`)];

        /* -------------------------------------------------- */
        /* BRANCH RESTRICTION                                 */
        /* -------------------------------------------------- */
        let branchRestriction = "";
        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) branchRestriction = `AND sts."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND sts."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------------------------------------- */
        /* COMMON FILTERS                                     */
        /* -------------------------------------------------- */
        
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${startDate && endDate ? `AND sts."transferDate"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            ${status ? `AND sts."StatusType" = '${status}'` : ""}
            AND (
                br."name" ILIKE $1
                OR tbr."name" ILIKE $1
                OR TO_CHAR(sts."transferDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sts."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sts."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sts."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sts."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sts."transferDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sts."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sts."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sts."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sts."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------------------------------------- */
        /* 21 TOTAL COUNT (PAGINATION)                       */
        /* -------------------------------------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT sts.id
                FROM "StockTransfers" sts
                LEFT JOIN "Branch" br ON sts."branchId" = br.id
                LEFT JOIN "Branch" tbr ON sts."toBranchId" = tbr.id
                LEFT JOIN "User" c ON sts."createdBy" = c.id
                LEFT JOIN "User" u ON sts."updatedBy" = u.id
                LEFT JOIN "User" ap ON sts."approvedBy" = ap.id
                LEFT JOIN "User" db ON sts."deletedBy" = db.id
                ${commonFilters}
                GROUP BY sts.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------------------------------------- */
        /* 3️ DATA LIST                                      */
        /* -------------------------------------------------- */
        const transfers: any = await prisma.$queryRawUnsafe(`
            SELECT 
                sts.*,
                COALESCE(SUM(td.quantity), 0) AS "totalQuantity",

                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', tbr.id, 'name', tbr.name) AS tobranch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                json_build_object('id', ap.id, 'firstName', ap."firstName", 'lastName', ap."lastName") AS approver,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter

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

            ORDER BY sts."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const transfersSafe = transfers.map((adj: any) => ({
            ...adj,
            id: Number(adj.id),
            branchId: Number(adj.branchId),
            totalQuantity: Number(adj.totalQuantity),
            createdBy: adj.createdBy ? Number(adj.createdBy) : null,
            updatedBy: adj.updatedBy ? Number(adj.updatedBy) : null,
            approvedBy: adj.approvedBy ? Number(adj.approvedBy) : null,
            deletedBy: adj.deletedBy ? Number(adj.deletedBy) : null
        }));

        // console.log("Data: ", transfers);
        // console.log("Summary: ", summarySafe);

        res.status(200).json({
            data: transfersSafe,
            total
        });

    } catch (error) {
        console.error("Report transfer report error:", error);
        res.status(500).json({ message: "Transfer report server error" });
    }
};

export const getAllReportRequests = async (
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
        const sortField = getQueryString(req.query.sortField, "ref")!;
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
                    c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR ap."firstName" ILIKE $${idx + 2}
                    OR ap."lastName" ILIKE $${idx + 2}
                    OR db."firstName" ILIKE $${idx + 2}
                    OR db."lastName" ILIKE $${idx + 2}
                    OR br."name" ILIKE $${idx + 2}
                    OR rqb."firstName" ILIKE $${idx + 2}
                    OR rqb."lastName" ILIKE $${idx + 2}
                )
            `)
            .join(" AND ");

        const params: any[] = [likeTerm, ...searchWords.map(w => `%${w}%`)];

        /* -------------------------------------------------- */
        /* BRANCH RESTRICTION                                 */
        /* -------------------------------------------------- */
        let branchRestriction = "";
        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) branchRestriction = `AND srq."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND srq."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------------------------------------- */
        /* COMMON FILTERS                                     */
        /* -------------------------------------------------- */
        
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${startDate && endDate ? `AND srq."requestDate"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            ${status ? `AND srq."StatusType" = '${status}'` : ""}
            AND (
                br."name" ILIKE $1
                OR TO_CHAR(srq."requestDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srq."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srq."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srq."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srq."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srq."requestDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srq."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srq."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srq."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srq."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------------------------------------- */
        /* 21 TOTAL COUNT (PAGINATION)                       */
        /* -------------------------------------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT srq.id
                FROM "StockRequests" srq
                LEFT JOIN "Branch" br ON srq."branchId" = br.id
                LEFT JOIN "User" c ON srq."createdBy" = c.id
                LEFT JOIN "User" u ON srq."updatedBy" = u.id
                LEFT JOIN "User" ap ON srq."approvedBy" = ap.id
                LEFT JOIN "User" db ON srq."deletedBy" = db.id
                LEFT JOIN "User" rqb ON srq."requestBy" = rqb.id
                ${commonFilters}
                GROUP BY srq.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------------------------------------- */
        /* 3️ DATA LIST                                      */
        /* -------------------------------------------------- */
        const requests: any = await prisma.$queryRawUnsafe(`
            SELECT 
                srq.*,
                COALESCE(SUM(rqd.quantity), 0) AS "totalQuantity",

                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                json_build_object('id', ap.id, 'firstName', ap."firstName", 'lastName', ap."lastName") AS approver,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter,
                json_build_object('id', rqb.id, 'firstName', rqb."firstName", 'lastName', rqb."lastName") AS requester

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
                rqb.id,
                ap.id,
                db.id

            ORDER BY srq."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const requestsSafe = requests.map((adj: any) => ({
            ...adj,
            id: Number(adj.id),
            branchId: Number(adj.branchId),
            totalQuantity: Number(adj.totalQuantity),
            createdBy: adj.createdBy ? Number(adj.createdBy) : null,
            updatedBy: adj.updatedBy ? Number(adj.updatedBy) : null,
            approvedBy: adj.approvedBy ? Number(adj.approvedBy) : null,
            deletedBy: adj.deletedBy ? Number(adj.deletedBy) : null,
            requestedBy: adj.requestBy ? Number(adj.requestBy) : null
        }));

        // console.log("Data: ", requests);
        // console.log("Summary: ", summarySafe);

        res.status(200).json({
            data: requestsSafe,
            total
        });

    } catch (error) {
        console.error("Report request report error:", error);
        res.status(500).json({ message: "Request report server error" });
    }
};

export const getAllReportReturns = async (
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
        const sortField = getQueryString(req.query.sortField, "ref")!;
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
                    c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR ap."firstName" ILIKE $${idx + 2}
                    OR ap."lastName" ILIKE $${idx + 2}
                    OR db."firstName" ILIKE $${idx + 2}
                    OR db."lastName" ILIKE $${idx + 2}
                    OR br."name" ILIKE $${idx + 2}
                    OR rtb."firstName" ILIKE $${idx + 2}
                    OR rtb."lastName" ILIKE $${idx + 2}
                )
            `)
            .join(" AND ");

        const params: any[] = [likeTerm, ...searchWords.map(w => `%${w}%`)];

        /* -------------------------------------------------- */
        /* BRANCH RESTRICTION                                 */
        /* -------------------------------------------------- */
        let branchRestriction = "";
        if (loggedInUser.roleType === "ADMIN") {
            if (branchId) branchRestriction = `AND srt."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND srt."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------------------------------------- */
        /* COMMON FILTERS                                     */
        /* -------------------------------------------------- */
        
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${startDate && endDate ? `AND srt."returnDate"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            ${status ? `AND srt."StatusType" = '${status}'` : ""}
            AND (
                br."name" ILIKE $1
                OR TO_CHAR(srt."returnDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srt."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srt."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srt."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srt."deletedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srt."returnDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srt."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srt."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srt."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(srt."deletedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------------------------------------- */
        /* 21 TOTAL COUNT (PAGINATION)                       */
        /* -------------------------------------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT srt.id
                FROM "StockReturns" srt
                LEFT JOIN "Branch" br ON srt."branchId" = br.id
                LEFT JOIN "User" c ON srt."createdBy" = c.id
                LEFT JOIN "User" u ON srt."updatedBy" = u.id
                LEFT JOIN "User" ap ON srt."approvedBy" = ap.id
                LEFT JOIN "User" db ON srt."deletedBy" = db.id
                LEFT JOIN "User" rtb ON srt."returnBy" = rtb.id
                ${commonFilters}
                GROUP BY srt.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------------------------------------- */
        /* 3️ DATA LIST                                      */
        /* -------------------------------------------------- */
        const returns: any = await prisma.$queryRawUnsafe(`
            SELECT 
                srt.*,
                COALESCE(SUM(rtd.quantity), 0) AS "totalQuantity",

                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                json_build_object('id', ap.id, 'firstName', ap."firstName", 'lastName', ap."lastName") AS approver,
                json_build_object('id', db.id, 'firstName', db."firstName", 'lastName', db."lastName") AS deleter,
                json_build_object('id', rtb.id, 'firstName', rtb."firstName", 'lastName', rtb."lastName") AS returner

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
                rtb.id,
                ap.id,
                db.id

            ORDER BY srt."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const returnsSafe = returns.map((adj: any) => ({
            ...adj,
            id: Number(adj.id),
            branchId: Number(adj.branchId),
            totalQuantity: Number(adj.totalQuantity),
            createdBy: adj.createdBy ? Number(adj.createdBy) : null,
            updatedBy: adj.updatedBy ? Number(adj.updatedBy) : null,
            approvedBy: adj.approvedBy ? Number(adj.approvedBy) : null,
            deletedBy: adj.deletedBy ? Number(adj.deletedBy) : null,
            returnBy: adj.returnBy ? Number(adj.returnBy) : null
        }));

        // console.log("Data: ", returns);
        // console.log("Summary: ", summarySafe);

        res.status(200).json({
            data: returnsSafe,
            total
        });

    } catch (error) {
        console.error("Report return report error:", error);
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
        const sortField = getQueryString(req.query.sortField, "ref")!;
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
        const sortField = getQueryString(req.query.sortField, "ref")!;
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
        /* -------------------------------------------------- */
        /* PAGINATION & FILTER PARAMS                         */
        /* -------------------------------------------------- */
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "ref")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "desc" : "asc";

        const startDate = req.query.startDate as string | undefined;
        const endDate = req.query.endDate as string | undefined;
        const saleType = req.query.saleType as string | undefined;
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
                    c."firstName" ILIKE $${idx + 2}
                    OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2}
                    OR u."lastName" ILIKE $${idx + 2}
                    OR cs."name" ILIKE $${idx + 2}
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
            if (branchId) branchRestriction = `AND sr."branchId" = ${branchId}`;
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND sr."branchId" = ${loggedInUser.branchId}`;
        }

        /* -------------------------------------------------- */
        /* COMMON FILTERS                                     */
        /* -------------------------------------------------- */
        const commonFilters = `
            WHERE 1=1
            ${branchRestriction}
            ${startDate && endDate ? `AND sr."createdAt"::date BETWEEN '${startDate}' AND '${endDate}'` : ""}
            AND (
                sr."ref" ILIKE $1
                OR cs."name" ILIKE $1
                OR br."name" ILIKE $1
                OR TO_CHAR(sr."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sr."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sr."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(sr."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `;

        /* -------------------------------------------------- */
        /* 1️ SUMMARY TOTALS                                   */
        /* -------------------------------------------------- */
        const summary: any = await prisma.$queryRawUnsafe(`
            SELECT
                COUNT(DISTINCT sr.id) AS "totalNumberSaleReturn",
                COALESCE(SUM(sr."totalAmount"), 0) AS "totalAmount"
            FROM "SaleReturns" sr
            LEFT JOIN "Customer" cs ON sr."customerId" = cs.id
            LEFT JOIN "Branch" br ON sr."branchId" = br.id
            LEFT JOIN "User" c ON sr."createdBy" = c.id
            LEFT JOIN "User" u ON sr."updatedBy" = u.id
            ${commonFilters}
        `, ...params);

        /* Convert BigInt in summary */
        const summarySafe = {
            totalNumberSaleReturn: Number(summary[0]?.totalNumberSaleReturn || 0),
            totalAmount: Number(summary[0]?.totalAmount || 0),
        };

        /* -------------------------------------------------- */
        /* 2️ TOTAL COUNT (PAGINATION)                       */
        /* -------------------------------------------------- */
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT sr.id
                FROM "SaleReturns" sr
                LEFT JOIN "Customer" cs ON sr."customerId" = cs.id
                LEFT JOIN "Branch" br ON sr."branchId" = br.id
                LEFT JOIN "User" c ON sr."createdBy" = c.id
                LEFT JOIN "User" u ON sr."updatedBy" = u.id
                ${commonFilters}
                GROUP BY sr.id
            ) AS t
        `, ...params);

        const total = Number(totalResult[0]?.total || 0);

        /* -------------------------------------------------- */
        /* 3️ DATA LIST                                      */
        /* -------------------------------------------------- */
        const saleReturns: any = await prisma.$queryRawUnsafe(`
            SELECT sr.*,
                json_build_object('id', cs.id, 'name', cs.name) AS customer,
                json_build_object('id', br.id, 'name', br.name) AS branch,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "SaleReturns" sr
            LEFT JOIN "Customer" cs ON sr."customerId" = cs.id
            LEFT JOIN "Branch" br ON sr."branchId" = br.id
            LEFT JOIN "User" c ON sr."createdBy" = c.id
            LEFT JOIN "User" u ON sr."updatedBy" = u.id
            ${commonFilters}
            ORDER BY sr."${sortField}" ${sortOrder}
            LIMIT ${pageSize} OFFSET ${offset}
        `, ...params);

        const saleReturnSafe = saleReturns.map((srt: any) => ({
            ...srt,
            id: Number(srt.id),
            branchId: Number(srt.branchId),
            customerId: srt.customerId ? Number(srt.customerId) : null,
            createdBy: srt.createdBy ? Number(srt.createdBy) : null,
            updatedBy: srt.updatedBy ? Number(srt.updatedBy) : null,
            totalAmount: Number(srt.totalAmount),
            grandTotal: Number(srt.totalAmount),
        }));

        // console.log("Data: ", saleReturnSafe);
        // console.log("Summary: ", summarySafe);

        res.status(200).json({
            data: saleReturnSafe,
            total,
            summary: summarySafe,
        });

    } catch (error) {
        console.error("Report sale return error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
