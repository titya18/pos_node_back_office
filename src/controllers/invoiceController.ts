import { Request, Response } from "express";
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

export const getAllInvoices = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "ref";
        const sortOrder = req.query.sortOrder === "asc" ? "desc" : "desc";
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
            branchRestriction = `AND rd."branchId" = ${loggedInUser.branchId}`;
        }

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Order" rd
            LEFT JOIN "Customer" cs ON rd."customerId" = cs.id
            LEFT JOIN "Branch" br ON rd."branchId" = br.id
            LEFT JOIN "User" c ON rd."createdBy" = c.id
            LEFT JOIN "User" u ON rd."updatedBy" = u.id
            LEFT JOIN "User" ab ON rd."approvedBy" = ab.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    rd."ref" ILIKE $1
                    OR cs."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(rd."orderDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // ----- 2) DATA FETCH -----
        const invoices: any = await prisma.$queryRawUnsafe(`
            SELECT rd.*,
                   json_build_object('id', cs.id, 'name', cs.name) AS customer,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                   json_build_object('id', ab.id, 'firstName', ab."firstName", 'lastName', ab."lastName") AS approver
            FROM "Order" rd
            LEFT JOIN "Customer" cs ON rd."customerId" = cs.id
            LEFT JOIN "Branch" br ON rd."branchId" = br.id
            LEFT JOIN "User" c ON rd."createdBy" = c.id
            LEFT JOIN "User" u ON rd."updatedBy" = u.id
            LEFT JOIN "User" ab ON rd."approvedBy" = ab.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    rd."ref" ILIKE $1
                    OR cs."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(rd."orderDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY rd."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: invoices, total });

    } catch (error) {
        console.error("Error fetching invoices:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};


export const upsertInvoice = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { branchId, customerId, taxRate, taxNet, discount, shipping, totalAmount, status, note, items, orderDate, OrderSaleType } = req.body;
    
    try {
        const result = await prisma.$transaction(async (tx) => {
            const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
            // Verify that loggedInUser is defined
            if (!loggedInUser) {
                res.status(401).json({ message: "User is not authenticated." });
                return;
            }

            const invoiceId = id ? parseInt(id, 10) : undefined;
            const checkInvoice = invoiceId
                ? await tx.order.findUnique({
                    where: { id: invoiceId },
                    select: {
                        status: true
                    },
                })
                : null;

            if (invoiceId && !checkInvoice) {
                res.status(404).json({ message: "Invoice not found!" });
                return;
            }

            let ref = "INV-";

            // Generate a new ref only for creation
            if (!id) {
                // Query for the highest ref in the same branch
                const lastInvoice = await tx.order.findFirst({
                    where: { branchId: parseInt(branchId, 10) },
                    orderBy: { id: 'desc' }, // Sort by ref in descending order
                });

                // Extract and increment the numeric part of the ref
                if (lastInvoice && lastInvoice.ref) {
                    const refNumber = parseInt(lastInvoice.ref.split('-')[1], 10) || 0;
                    ref += String(refNumber + 1).padStart(5, '0'); // Increment and format with leading zeros
                } else {
                    ref += "00001"; // Start from 00001 if no ref exists for the branch
                }
            }

            const invoice = invoiceId
                ? await tx.order.update({
                    where: { id: invoiceId },
                    data: {
                        branchId: parseInt(branchId, 10),
                        customerId: parseInt(customerId, 10),
                        orderDate: new Date(dayjs(orderDate).format("YYYY-MM-DD")),
                        OrderSaleType,
                        taxRate,
                        taxNet,
                        discount,
                        shipping,
                        totalAmount,
                        status,
                        note,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null,
                        items: {
                            deleteMany: {
                                orderId: invoiceId   // MUST include a filter
                            }, // Delete existing quotation details
                            create: items.map((detail: any) => ({
                                productId: detail.productId ? parseInt(detail.productId, 10) : null,
                                productVariantId: detail.productVariantId ? parseInt(detail.productVariantId, 10) : null,
                                serviceId: detail.serviceId ? parseInt(detail.serviceId, 10) : null,
                                price: parseFloat(detail.price),
                                ItemType: detail.ItemType,
                                taxNet: parseFloat(detail.taxNet),
                                taxMethod: detail.taxMethod,
                                discount: detail.discount ? parseFloat(detail.discount) : undefined,
                                discountMethod: detail.discountMethod,
                                total: parseFloat(detail.total),
                                quantity: parseInt(detail.quantity, 10),
                            })),
                        },
                    },
                    include: {
                        items: {
                            include: {
                                products: true,
                                productvariants: true,
                            },
                        },
                    },
                })
                : await tx.order.create({
                    data: {
                        branchId: parseInt(branchId, 10),
                        customerId: parseInt(customerId, 10),
                        OrderSaleType,
                        ref,
                        taxRate,
                        taxNet,
                        discount,
                        shipping,
                        totalAmount,
                        status,
                        note,
                        orderDate: new Date(dayjs(orderDate).format("YYYY-MM-DD")),
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null,
                        items: {
                            create: items.map((detail: any) => ({
                                productId: detail.productId ? parseInt(detail.productId, 10) : null,
                                productVariantId: detail.productVariantId ? parseInt(detail.productVariantId, 10) : null,
                                serviceId: detail.serviceId ? parseInt(detail.serviceId, 10) : null,
                                price: parseFloat(detail.price),
                                ItemType: detail.ItemType,
                                taxNet: parseFloat(detail.taxNet),
                                taxMethod: detail.taxMethod,
                                discount: detail.discount ? parseFloat(detail.discount) : undefined,
                                discountMethod: detail.discountMethod,
                                total: parseFloat(detail.total),
                                quantity: parseInt(detail.quantity, 10),
                            })),
                        },
                    },
                    include: {
                        items: {
                            include: {
                                products: true,
                                productvariants: true,
                            },
                        },
                    },
                });
            
            const shouldDeductStock =
                (!checkInvoice && status === "APPROVED") || // new invoice approved
                (checkInvoice?.status !== "APPROVED" && status === "APPROVED");

            if (shouldDeductStock) {
                for (const item of invoice.items) {
                    if (item.ItemType !== "PRODUCT" || !item.productVariantId) continue;

                    // Get stock row
                    const stock = await tx.stocks.findUnique({
                        where: {
                            productVariantId_branchId: {
                                productVariantId: item.productVariantId,
                                branchId: invoice.branchId,
                            },
                        },
                    });

                    if (!stock || stock.quantity.toNumber() < item.quantity) {
                        throw new Error("Insufficient stock for barcode: " + item.productvariants?.barcode);
                    }

                    // Update stock
                    await tx.stocks.update({
                        where: { id: stock.id },
                        data: {
                            quantity: {
                                decrement: item.quantity,
                            },
                            updatedAt: currentDate,
                            updatedBy: req.user ? req.user.id : null,
                        },
                    });

                    // Insert stock movement
                    await tx.stockMovements.create({
                        data: {
                            productVariantId: item.productVariantId,
                            branchId: invoice.branchId,
                            type: "ORDER",
                            quantity: item.quantity,
                            note: `Invoice #${invoice.ref}`,
                            createdBy: req.user ? req.user.id : null,
                            createdAt: currentDate
                        },
                    });
                }
            }

            return invoice;
        });
        
        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error creating/updating invoice:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const insertInvoicePayment = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await prisma.$transaction(async (prisma) => {
            const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
            // Verify that loggedInUser is defined
            if (!loggedInUser) {
                res.status(401).json({ message: "User is not authenticated." });
                return;
            }

            const { branchId, orderId, paymentMethodId, totalPaid, due_balance } = req.body;

            // Fetch the purchase to get the grandTotal
            const invoice = await prisma.order.findUnique({
                where: { id: orderId },
                select: { totalAmount: true, paidAmount: true },
            });

            if (!invoice) {
                res.status(404).json({ message: "Invoice not found" });
                return;
            }

            // Handle null for paidAmount by defaulting to 0 if it's null
            const paidAmountNumber = invoice.paidAmount ? invoice.paidAmount.toNumber() : 0;
            const amountNumber = Number(totalPaid); // Convert amount to number if it's not already

            // Calculate the new paidAmount
            // Safely handle possible null totalAmount
            const totalAmountNumber = invoice.totalAmount ? invoice.totalAmount.toNumber() : 0;

            // Calculate the new paidAmount
            const newPaidAmount = totalAmountNumber <= amountNumber
                ? totalAmountNumber
                : (totalAmountNumber - paidAmountNumber) <= amountNumber
                ? totalAmountNumber
                : (paidAmountNumber + amountNumber); // Now properly add as numbers

            await prisma.order.update({
                where: { id: orderId },
                data: {
                    paidAmount: newPaidAmount,
                    ...(due_balance <= 0 && {
                        status: "COMPLETED",
                        // paymentStatus: "PAID"
                    })
                }
            });

            const amountNum = Number(totalPaid);
            const dueNum = Number(due_balance);
            const finalAmount = dueNum <= 0
                                    ? new Decimal(amountNum).plus(dueNum)
                                    : new Decimal(amountNum);
            const invoicePayment = await prisma.orderOnPayments.create({
                data: {
                    branchId: parseInt(branchId, 10),
                    orderId: parseInt(orderId, 10),
                    paymentMethodId: parseInt(paymentMethodId, 10),
                    paymentDate: currentDate,
                    totalPaid: finalAmount,
                    createdAt: currentDate,
                    createdBy: req.user ? req.user.id : null,
                    updatedAt: currentDate,
                    updatedBy: req.user ? req.user.id : null,
                }
            });

            return invoicePayment;
        });
        res.status(201).json(result);
    } catch (error) {
        logger.error("Error inserting purchase payment:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}

export const getInvoiceById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const order = await prisma.order.findUnique({
            where: { id: parseInt(id, 10) },
            include: { 
                items: {
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
            }, // Include related quotation details
        });

        if (!order) {
            res.status(404).json({ message: "Invoice not found!" });
            return;
        }
        res.status(200).json(order);
    } catch (error) {
        logger.error("Error fetching invoice by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getInvoicePaymentById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const purchasePayment = await prisma.orderOnPayments.findMany({ 
            where: { orderId: parseInt(id, 10) },
            orderBy: { id: 'desc' },
            include: {
                paymentMethods: {
                    select: {
                        name: true
                    }
                }
            } 
        });
        res.status(200).json(purchasePayment);
    } catch (error) {
        logger.error("Error fetching invoice payment by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}

export const deleteInvoice = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { delReason } = req.body;
    try {
        const order = await prisma.order.findUnique({ 
            where: { id: parseInt(id, 10) },
            include: { items: true } 
        });
        if (!order) {
            res.status(404).json({ message: "Invoice not found!" });
            return;
        }
        await prisma.order.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason,
                status: "CANCELLED"
            }
        });
        res.status(200).json(order);
    } catch (error) {
        logger.error("Error deleting invoice:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const approveInvoice = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1 Fetch quotation with details
            const invoice = await tx.order.findUnique({
                where: { id: Number(id) },
                include: {
                    items: {
                        include: {
                            products: true,
                            productvariants: true,
                        },
                    },
                },
            });

            if (!invoice) {
                throw new Error("Invoice not found");
            }

            if (invoice.approvedAt) {
                throw new Error("Invoice already approved");
            }

            for (const item of invoice.items) {
                if (item.ItemType !== "PRODUCT" || !item.productVariantId) continue;

                // Get stock row
                const stock = await tx.stocks.findUnique({
                    where: {
                        productVariantId_branchId: {
                            productVariantId: item.productVariantId,
                            branchId: invoice.branchId,
                        },
                    },
                });

                if (!stock || stock.quantity.toNumber() < item.quantity) {
                    throw new Error("Insufficient stock for barcode: " + item.productvariants?.barcode);
                }

                // Update stock
                await tx.stocks.update({
                    where: { id: stock.id },
                    data: {
                        quantity: {
                            decrement: item.quantity,
                        },
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null,
                    },
                });

                // Insert stock movement
                await tx.stockMovements.create({
                    data: {
                        productVariantId: item.productVariantId,
                        branchId: invoice.branchId,
                        type: "ORDER",
                        quantity: item.quantity,
                        note: `Invoice #${invoice.ref}`,
                        createdBy: req.user ? req.user.id : null,
                        createdAt: currentDate
                    },
                });
            }

            // 3 Update quotation status
            await tx.order.update({
                where: { id: invoice.id },
                data: {
                    approvedAt: currentDate,
                    approvedBy: req.user ? req.user.id : null,
                    status: "APPROVED",
                },
            });

            return invoice;
        });
        res.status(201).json(result);
    } catch (error) {
        logger.error("Error approve invoice:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};