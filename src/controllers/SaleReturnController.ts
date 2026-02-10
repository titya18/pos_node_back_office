import e, { Request, Response } from "express";
import { ItemType, PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
import { Decimal } from "@prisma/client/runtime/library"
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

const prisma = new PrismaClient();

export const getAllSaleReturnsWithPagination = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "ref";
        const sortOrder = req.query.sortOrder === "asc" ? "desc" : "asc";
        const offset = (pageNumber - 1) * pageSize;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        // Base LIKE term
        const likeTerm = `%${searchTerm}%`;

        // Split into words ("Lorn Titya")
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        // Build full name conditions
        const fullNameConditions = searchWords
            .map((_, idx) => `
                (c."firstName" ILIKE $${idx + 2} OR c."lastName" ILIKE $${idx + 2}
                 OR u."firstName" ILIKE $${idx + 2} OR u."lastName" ILIKE $${idx + 2}
                 OR cs."name" ILIKE $${idx + 2}
                 OR br."name" ILIKE $${idx + 2})
            `)
            .join(" AND ");

        // Build parameters: $1 = likeTerm, $2..$n = searchword, $n+1 = limit, $n+2 = offset
        const params = [likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // Branch restriction
        let branchRestriction = "";
        if (loggedInUser.roleType === "USER" && loggedInUser.branchId) {
            branchRestriction = `
                AND rd."branchId" = ${loggedInUser.branchId}
                AND rd."createdBy" = ${loggedInUser.id}
            `;
        }

        // If we want to use this AND condition, we need to copy it and past below WHERE 1=1 ${branchRestriction}
        // AND (
        //             rd."status" NOT IN ('COMPLETED', 'CANCELLED')
        //             OR rd."orderDate"::date >= CURRENT_DATE
        //         )

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "SaleReturns" sr
            LEFT JOIN "Order" rd ON sr."orderId" = rd.id
            LEFT JOIN "Customer" cs ON sr."customerId" = cs.id
            LEFT JOIN "Branch" br ON sr."branchId" = br.id
            LEFT JOIN "User" c ON sr."createdBy" = c.id
            LEFT JOIN "User" u ON sr."updatedBy" = u.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    sr."ref" ILIKE $1
                    OR rd."ref" ILIKE $1
                    OR cs."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // If we want to use this AND condition, we need to copy it and past below WHERE 1=1 ${branchRestriction}
        // AND (
        //     rd."status" NOT IN ('COMPLETED', 'CANCELLED')
        //     OR rd."orderDate"::date >= CURRENT_DATE
        // )
        // ----- 2) DATA FETCH -----
        const invoices: any = await prisma.$queryRawUnsafe(`
            SELECT sr.*,
                   json_build_object('id', rd.id, 'ref', rd.ref) AS order,
                   json_build_object('id', cs.id, 'name', cs.name) AS customer,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "SaleReturns" sr
            LEFT JOIN "Order" rd ON sr."orderId" = rd.id
            LEFT JOIN "Customer" cs ON sr."customerId" = cs.id
            LEFT JOIN "Branch" br ON sr."branchId" = br.id
            LEFT JOIN "User" c ON sr."createdBy" = c.id
            LEFT JOIN "User" u ON sr."updatedBy" = u.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    sr."ref" ILIKE $1
                    OR rd."ref" ILIKE $1
                    OR cs."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY sr."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: invoices, total });

    } catch (error) {
        console.error("Error fetching sale returns:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const createSaleReturn = async (
    req: Request,
    res: Response
): Promise<void> => {
    const {
        orderId,
        branchId,
        customerId,
        status,
        note,
        items,
    } = req.body;

    if (!items || items.length === 0) {
        res.status(400).json({ message: "No items to return" });
        return;
    }

    const userId = req.user?.id;
    const now = new Date();

    try {
        const result = await prisma.$transaction(async (tx) => {

            /* -------------------------------------------------------
            1️ LOAD ORDER
            ------------------------------------------------------- */
            const order = await tx.order.findUnique({
                where: { id: orderId },
                select: {
                    id: true,
                    discount: true,
                    taxRate: true,
                },
            });

            if (!order) throw new Error("Order not found");

            /* -------------------------------------------------------
            2️ GENERATE RETURN REF
            ------------------------------------------------------- */
            let ref = "SR-00001";

            const lastReturn = await tx.saleReturns.findFirst({
                where: { branchId },
                orderBy: { id: "desc" },
            });

            if (lastReturn?.ref) {
                const lastNo = parseInt(lastReturn.ref.split("-")[1]) || 0;
                ref = `SR-${String(lastNo + 1).padStart(5, "0")}`;
            }

            /* -------------------------------------------------------
            3️ RETURN ITEMS SUBTOTAL
            ------------------------------------------------------- */
            let itemsSubtotal = 0;

            for (const item of items) {
                const netUnit =
                    item.discountMethod === "Fixed"
                        ? Number(item.price) - Number(item.discount)
                        : Number(item.price) *
                          ((100 - Number(item.discount)) / 100);

                itemsSubtotal += netUnit * Number(item.quantity);
            }

            if (itemsSubtotal <= 0) {
                throw new Error("Invalid return subtotal");
            }

            /* -------------------------------------------------------
            4️ FULL ORDER SUBTOTAL
            ------------------------------------------------------- */
            const orderItemsAgg = await tx.orderItem.aggregate({
                where: { orderId },
                _sum: { total: true },
            });

            const invoiceSubtotal = Number(orderItemsAgg._sum.total || 0);
            if (invoiceSubtotal <= 0) {
                throw new Error("Invalid invoice subtotal");
            }

            /* -------------------------------------------------------
            5️ PRORATE DISCOUNT & TAX
            ------------------------------------------------------- */
            const returnRatio = itemsSubtotal / invoiceSubtotal;

            const rawReturnDiscount =
                Number(order.discount || 0) * returnRatio;

            const taxableAmount = itemsSubtotal - rawReturnDiscount;

            const rawReturnTax =
                taxableAmount * (Number(order.taxRate || 0) / 100);

            /* -------------------------------------------------------
            6️ PREVIOUS RETURNS (DISCOUNT + TAX)
            ------------------------------------------------------- */
            const previousReturns = await tx.saleReturns.aggregate({
                where: { orderId },
                _sum: {
                    discount: true,
                    taxNet: true,
                },
            });

            const prevDiscount = Number(previousReturns._sum.discount || 0);
            const prevTax = Number(previousReturns._sum.taxNet || 0);

            const maxOrderTax =
                (invoiceSubtotal - Number(order.discount || 0)) *
                (Number(order.taxRate || 0) / 100);

            /* -------------------------------------------------------
            ✅ FIX: CAP DISCOUNT & TAX (ROUNDING SAFE)
            ------------------------------------------------------- */
            const remainingDiscount =
                Number(order.discount || 0) - prevDiscount;

            const remainingTax =
                maxOrderTax - prevTax;

            const returnDiscount = Math.min(
                rawReturnDiscount,
                remainingDiscount
            );

            const returnTax = Math.min(
                rawReturnTax,
                remainingTax
            );

            const returnTotal =
                taxableAmount - (rawReturnDiscount - returnDiscount) +
                returnTax;

            /* -------------------------------------------------------
            7️ CREATE SALE RETURN
            ------------------------------------------------------- */
            const saleReturn = await tx.saleReturns.create({
                data: {
                    orderId,
                    branchId,
                    customerId,
                    ref,
                    discount: returnDiscount,
                    taxRate: order.taxRate,
                    taxNet: returnTax,
                    shipping: 0,
                    totalAmount: returnTotal,
                    status,
                    note,
                    createdBy: userId,
                    updatedBy: userId,
                    createdAt: now,
                    updatedAt: now,
                },
            });

            /* -------------------------------------------------------
            8️ PROCESS RETURN ITEMS
            ------------------------------------------------------- */
            for (const item of items) {

                /* -----------------------------
                CREATE RETURN ITEM (ALL TYPES)
                ----------------------------- */
                const returnItem = await tx.saleReturnItems.create({
                    data: {
                        saleReturnId: saleReturn.id,
                        saleItemId: item.orderItemId,
                        productVariantId: item.productVariantId ?? null,
                        productId: item.productId,
                        serviceId: item.serviceId ?? null,
                        ItemType: item.ItemType,
                        quantity: item.quantity,
                        price: item.price,
                        discount: item.discount,
                        discountMethod: item.discountMethod,
                        taxNet: item.taxNet,
                        taxMethod: item.taxMethod,
                        total: item.total,
                    },
                });

                /* =====================================================
                🔥 STOCK & FIFO — PRODUCT ONLY
                ===================================================== */
                if (item.ItemType === "PRODUCT") {

                    if (!item.productVariantId) {
                        throw new Error("Product return requires productVariantId");
                    }

                    /* ---------- VALIDATE QTY ---------- */
                    const returnedAgg = await tx.saleReturnItems.aggregate({
                        where: { saleItemId: item.orderItemId },
                        _sum: { quantity: true },
                    });

                    const alreadyReturned = Number(returnedAgg._sum.quantity || 0);

                    const orderItem = await tx.orderItem.findUnique({
                        where: { id: item.orderItemId },
                    });

                    if (!orderItem) {
                        throw new Error(`Order item ${item.orderItemId} not found`);
                    }

                    if (alreadyReturned > Number(orderItem.quantity)) {
                        throw new Error(
                            `Return exceeds available quantity for order item ${item.orderItemId}`
                        );
                    }

                    /* ---------- FIFO RESTORE ---------- */
                    let qtyToRestore = item.quantity;

                    const soldMovements = await tx.stockMovements.findMany({
                        where: {
                            orderItemId: item.orderItemId,
                            productVariantId: item.productVariantId,
                            branchId,
                            type: "ORDER",
                            status: "APPROVED",
                        },
                        orderBy: { createdAt: "asc" },
                    });

                    for (const mov of soldMovements) {
                        if (qtyToRestore <= 0) break;

                        const soldQty = Math.abs(Number(mov.quantity));
                        const restoreQty = Math.min(soldQty, qtyToRestore);

                        await tx.stockMovements.create({
                            data: {
                                productVariantId: item.productVariantId,
                                branchId,
                                orderItemId: item.orderItemId,
                                saleReturnItemId: returnItem.id,
                                type: "SALE_RETURN",
                                status: "APPROVED",
                                quantity: restoreQty,
                                unitCost: mov.unitCost,
                                sourceMovementId: mov.id,
                                remainingQty: restoreQty,
                                note: `Sale Return #${ref}`,
                                createdBy: userId,
                                approvedBy: userId,
                                createdAt: now,
                                approvedAt: now,
                            },
                        });

                        qtyToRestore -= restoreQty;
                    }

                    if (qtyToRestore > 0) {
                        throw new Error("FIFO restore quantity mismatch");
                    }

                    /* ---------- UPDATE STOCK ---------- */
                    await tx.stocks.update({
                        where: {
                            productVariantId_branchId: {
                                productVariantId: item.productVariantId,
                                branchId,
                            },
                        },
                        data: {
                            quantity: { increment: item.quantity },
                            updatedBy: userId,
                            updatedAt: now,
                        },
                    });
                }
            }

            /* ------------------------------------------------------- 
            9️ PAYMENT REVERSAL (REFUND) 
            ------------------------------------------------------- */ 
            const payments = await tx.orderOnPayments.findMany({ where: { orderId }, }); 
            
            for (const pay of payments) { 
                if (Number(pay.totalPaid) > 0) { 
                    await tx.orderOnPayments.create({ 
                        data: { 
                            branchId, 
                            orderId, 
                            paymentDate: now, 
                            paymentMethodId: pay.paymentMethodId, 
                            totalPaid: new Decimal(-Number(pay.totalPaid)), 
                            receive_usd: pay.receive_usd ? new Decimal(-Number(pay.receive_usd)) : null, 
                            receive_khr: pay.receive_khr ? -Number(pay.receive_khr) : null, 
                            exchangerate: pay.exchangerate, 
                            status: "REFUND", 
                            createdBy: userId 
                        }, 
                    }); 
                }
            }

            /* -------------------------------------------------------
            10 UPDATE ORDER TOTAL
            ------------------------------------------------------- */
            await tx.order.update({
                where: { id: orderId },
                data: {
                    totalAmount: {
                        decrement: returnTotal,
                    },
                    returnstatus: 1
                },
            });

            return saleReturn;
        });

        res.status(201).json(result);

    } catch (error: any) {
        console.error(error);
        res.status(500).json({
            message: error?.message || "Sale return failed",
        });
    }
};

export const getSaleReturnById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
        const saleReturn = await prisma.saleReturns.findMany({
            where: { orderId: Number(id) },
            include: {
                SaleReturns: {
                    include: {
                        products: true, // Include related products data
                        productvariants: {
                            select: {
                                name: true, // Select the `name` field from `productVariant`
                                barcode: true,
                                sku: true
                            },
                        },
                        services: true, // Include related services data
                    },
                },
                customer: true, // Include related customer data
                branch: true, // Include related branch data
                creator: true, // Include related creator data
                updater: true, // Include related updater data
            }, // Include related quotation details
            // Include related quotation details
        });

        if (!saleReturn) {
            res.status(404).json({ message: "Sale Return not found!" });
            return;
        }

        res.status(200).json(saleReturn);
    } catch (error) {
        logger.error("Error fetching sale return by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getSaleReturnByReturnId = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
        const saleReturn = await prisma.saleReturns.findUnique({
            where: { id: Number(id) },
            include: {
                SaleReturns: {
                    include: {
                        products: true, // Include related products data
                        productvariants: {
                            select: {
                                name: true, // Select the `name` field from `productVariant`
                                barcode: true,
                                sku: true
                            },
                        },
                        services: true, // Include related services data
                    },
                },
                customer: true, // Include related customer data
                branch: true, // Include related branch data
                creator: true, // Include related creator data
                updater: true, // Include related updater data
            }, // Include related quotation details
            // Include related quotation details
        });

        if (!saleReturn) {
            res.status(404).json({ message: "Sale Return not found!" });
            return;
        }

        res.status(200).json(saleReturn);
    } catch (error) {
        logger.error("Error fetching sale return by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};


