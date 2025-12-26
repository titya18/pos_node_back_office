import { Request, Response } from "express";
import { ItemType, PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

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
        /* -------------------------------------------------- */
        /* PAGINATION & FILTER PARAMS                         */
        /* -------------------------------------------------- */
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page as string, 10) || 1;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = ((req.query.searchTerm as string) || "").trim();
        const sortField = (req.query.sortField as string) || "ref";
        const sortOrder = req.query.sortOrder === "desc" ? "asc" : "desc";

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
            AND rd."status" != 'CANCELLED'
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
                OR TO_CHAR(rd."orderDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(rd."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
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

export const getAllCancelReportInvoices = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        /* -------------------------------------------------- */
        /* PAGINATION & FILTER PARAMS                         */
        /* -------------------------------------------------- */
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page as string, 10) || 1;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = ((req.query.searchTerm as string) || "").trim();
        const sortField = (req.query.sortField as string) || "ref";
        const sortOrder = req.query.sortOrder === "desc" ? "asc" : "desc";

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
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page as string, 10) || 1;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = ((req.query.searchTerm as string) || "").trim();
        const sortField = (req.query.sortField as string) || "paymentDate";
        const sortOrder = req.query.sortOrder === "desc" ? "asc" : "desc";

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
                branchRestriction = `AND o."branchId" = ${branchId}`;
            }
        } else {
            if (!loggedInUser.branchId) {
                res.status(403).json({ message: "Branch not assigned." });
                return;
            }
            branchRestriction = `AND o."branchId" = ${loggedInUser.branchId}`;
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
            ${saleType ? `AND o."OrderSaleType" = '${saleType}'` : ""}
            ${status ? `AND o."status" = '${status}'` : ""}
            ${dateFilter}
            AND (
                o."ref" ILIKE $1
                OR cs."name" ILIKE $1
                OR br."name" ILIKE $1
                OR TO_CHAR(op."paymentDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(op."paymentDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
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
            LEFT JOIN "User" u ON op."updatedBy" = u.id
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
            LEFT JOIN "User" u ON op."updatedBy" = u.id
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
            "updatedAt"
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
                json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "OrderOnPayments" op
            LEFT JOIN "Order" o ON op."orderId" = o.id
            LEFT JOIN "Customer" cs ON o."customerId" = cs.id
            LEFT JOIN "PaymentMethods" pm ON o."customerId" = pm.id
            LEFT JOIN "Branch" br ON o."branchId" = br.id
            LEFT JOIN "User" c ON op."createdBy" = c.id
            LEFT JOIN "User" u ON op."updatedBy" = u.id
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
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page as string, 10) || 1;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = ((req.query.searchTerm as string) || "").trim();
        const sortField = (req.query.sortField as string) || "ref";
        const sortOrder = req.query.sortOrder === "desc" ? "asc" : "desc";

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
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page as string, 10) || 1;
        const offset = (pageNumber - 1) * pageSize;

        const searchTerm = ((req.query.searchTerm as string) || "").trim();
        const sortField = (req.query.sortField as string) || "ref";
        const sortOrder = req.query.sortOrder === "desc" ? "asc" : "desc";

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
        console.log("Data: ", purchaseSafe);
        console.log("Summary: ", summarySafe);

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
