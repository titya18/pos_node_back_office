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

export const getAllQuotations = async (req: Request, res: Response): Promise<void> => {
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
            branchRestriction = `AND q."branchId" = ${loggedInUser.branchId}`;
        }

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Quotations" q
            LEFT JOIN "Customer" cs ON q."customerId" = cs.id
            LEFT JOIN "Branch" br ON q."branchId" = br.id
            LEFT JOIN "User" c ON q."createdBy" = c.id
            LEFT JOIN "User" u ON q."updatedBy" = u.id
            LEFT JOIN "User" sb ON q."sentBy" = sb.id
            LEFT JOIN "User" ib ON q."invoicedBy" = ib.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    q."ref" ILIKE $1
                    OR cs."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(q."quotationDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."sentAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."invoicedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."sentAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."invoicedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // ----- 2) DATA FETCH -----
        const quotations: any = await prisma.$queryRawUnsafe(`
            SELECT q.*,
                   json_build_object('id', cs.id, 'name', cs.name) AS customer,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                   json_build_object('id', sb.id, 'firstName', sb."firstName", 'lastName', sb."lastName") AS sender,
                   json_build_object('id', ib.id, 'firstName', ib."firstName", 'lastName', ib."lastName") AS invoicer
            FROM "Quotations" q
            LEFT JOIN "Customer" cs ON q."customerId" = cs.id
            LEFT JOIN "Branch" br ON q."branchId" = br.id
            LEFT JOIN "User" c ON q."createdBy" = c.id
            LEFT JOIN "User" u ON q."updatedBy" = u.id
            LEFT JOIN "User" sb ON q."sentBy" = sb.id
            LEFT JOIN "User" ib ON q."invoicedBy" = ib.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    q."ref" ILIKE $1
                    OR cs."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(q."quotationDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."sentAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."invoicedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."sentAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."invoicedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY q."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: quotations, total });

    } catch (error) {
        console.error("Error fetching quotations:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const getNextQuotationRef = async (req: Request, res: Response): Promise<void> => {
    const { branchId } = req.params;

    if (!branchId) {
        res.status(400).json({ message: "Branch ID is required" });
        return;
    }

    const lastQuotation = await prisma.quotations.findFirst({
        where: {
            branchId: parseInt(branchId, 10),
        },
        orderBy: {
            id: "desc",
        },
        select: {
            ref: true,
        },
    });

    let nextRef = "QR-00001";

    if (lastQuotation?.ref) {
        const lastNumber = parseInt(lastQuotation.ref.split("-")[1], 10) || 0;
        nextRef = `QR-${String(lastNumber + 1).padStart(5, "0")}`;
    }

    res.json({ ref: nextRef });
};

export const upsertQuotation = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { ref, branchId, customerId, taxRate, taxNet, discount, shipping, grandTotal, status, note, quotationDetails, quotationDate, QuoteSaleType } = req.body;
    
    try {
        const result = await prisma.$transaction(async (tx) => {
            const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
            // Verify that loggedInUser is defined
            if (!loggedInUser) {
                res.status(401).json({ message: "User is not authenticated." });
                return;
            }

            const quotationId = id ? parseInt(id, 10) : undefined;
            if (quotationId) {
                const checkQuotation = await tx.quotations.findUnique({ where: { id: quotationId } });
                if (!checkQuotation) {
                    res.status(404).json({ message: "Quotation not found!" });
                    return;
                }
            }

            const checkRef = await tx.quotations.findFirst({
                where: { 
                    branchId: Number(branchId),
                    ref: ref,
                    ...(quotationId && {
                        id: { not: quotationId }
                    })
                 },
            });

            if (checkRef) {
                res.status(400).json({ message: "Invoice # already exists!" });
                return;
            }

            // let ref = "QR-";

            // // Generate a new ref only for creation
            // if (!id) {
            //     // Query for the highest ref in the same branch
            //     const lastQuotation = await prisma.quotations.findFirst({
            //         where: { branchId: parseInt(branchId, 10) },
            //         orderBy: { id: 'desc' }, // Sort by ref in descending order
            //     });

            //     // Extract and increment the numeric part of the ref
            //     if (lastQuotation && lastQuotation.ref) {
            //         const refNumber = parseInt(lastQuotation.ref.split('-')[1], 10) || 0;
            //         ref += String(refNumber + 1).padStart(5, '0'); // Increment and format with leading zeros
            //     } else {
            //         ref += "00001"; // Start from 00001 if no ref exists for the branch
            //     }
            // }

            const quotation = quotationId
                ? await tx.quotations.update({
                    where: { id: quotationId },
                    data: {
                        ref,
                        branchId: parseInt(branchId, 10),
                        customerId: parseInt(customerId, 10),
                        quotationDate: new Date(dayjs(quotationDate).format("YYYY-MM-DD")),
                        QuoteSaleType,
                        taxRate,
                        taxNet,
                        discount,
                        shipping,
                        grandTotal,
                        status,
                        note,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null,
                        sentAt: status === "SENT" ? currentDate : null,
                        sentBy: status === "SENT" ? req.user ? req.user.id : null : null,
                        quotationDetails: {
                            deleteMany: {
                                quotationId: quotationId   // MUST include a filter
                            }, // Delete existing quotation details
                            create: quotationDetails.map((detail: any) => ({
                                productId: detail.productId ? parseInt(detail.productId, 10) : null,
                                productVariantId: detail.productVariantId ? parseInt(detail.productVariantId, 10) : null,
                                serviceId: detail.serviceId ? parseInt(detail.serviceId, 10) : null,
                                cost: parseFloat(detail.cost),
                                ItemType: detail.ItemType,
                                taxNet: parseFloat(detail.taxNet),
                                taxMethod: detail.taxMethod,
                                discount: detail.discount ? parseFloat(detail.discount) : undefined,
                                discountMethod: detail.discountMethod,
                                total: parseFloat(detail.total),
                                quantity: parseInt(detail.quantity, 10),
                            })),
                        },
                    }
                })
                : await tx.quotations.create({
                    data: {
                        branchId: parseInt(branchId, 10),
                        customerId: parseInt(customerId, 10),
                        QuoteSaleType,
                        ref,
                        taxRate,
                        taxNet,
                        discount,
                        shipping,
                        grandTotal,
                        status,
                        note,
                        quotationDate: new Date(dayjs(quotationDate).format("YYYY-MM-DD")),
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null,
                        sentAt: status === "SENT" ? currentDate : null,
                        sentBy: status === "SENT" ? req.user ? req.user.id : null : null,
                        quotationDetails: {
                            create: quotationDetails.map((detail: any) => ({
                                productId: detail.productId ? parseInt(detail.productId, 10) : null,
                                productVariantId: detail.productVariantId ? parseInt(detail.productVariantId, 10) : null,
                                serviceId: detail.serviceId ? parseInt(detail.serviceId, 10) : null,
                                cost: parseFloat(detail.cost),
                                ItemType: detail.ItemType,
                                taxNet: parseFloat(detail.taxNet),
                                taxMethod: detail.taxMethod,
                                discount: detail.discount ? parseFloat(detail.discount) : undefined,
                                discountMethod: detail.discountMethod,
                                total: parseFloat(detail.total),
                                quantity: parseInt(detail.quantity, 10),
                            })),
                        },
                    }
                });

            return quotation;
        });
        
        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error creating/updating quotation:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getQuotationById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const quotation = await prisma.quotations.findUnique({
            where: { id: parseInt(id, 10) },
            include: { 
                quotationDetails: {
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
                customers: true, // Include related customer data
                branch: true, // Include related branch data
                creator: true, // Include related creator data
                updater: true, // Include related updater data
            }, // Include related quotation details
        });

        // Transform data to flatten `name` into `quotationDetails`
        // if (quotation) {
        //     quotation.quotationDetails = quotation.quotationDetails.map((detail: any) => ({
        //         ...detail,
        //         name: detail.ItemType === "PRODUCT" ? detail.productvariants.name : detail.services.name, // Add `name` directly
        //     }));
        // }

        if (!quotation) {
            res.status(404).json({ message: "Quotation not found!" });
            return;
        }
        res.status(200).json(quotation);
    } catch (error) {
        logger.error("Error fetching quotation by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteQuotation = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { delReason } = req.body;
    try {
        const quotation = await prisma.quotations.findUnique({ 
            where: { id: parseInt(id, 10) },
            include: { quotationDetails: true } 
        });

        if (!quotation) {
            res.status(404).json({ message: "Quotation not found!" });
            return;
        }
        await prisma.quotations.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason,
                status: "CANCELLED"
            }
        });
        res.status(200).json(quotation);
    } catch (error) {
        logger.error("Error deleting quotation:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const convertQuotationToOrder = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1 Fetch quotation with details
            const quotation = await tx.quotations.findUnique({
                where: { id: Number(id) },
                include: {
                    quotationDetails: {
                        include: {
                            productvariants: true
                        },
                    },
                },
            });

            if (!quotation) {
                throw new Error("Quotation not found");
            }

            if (quotation.invoicedAt) {
                throw new Error("Quotation already converted to order");
            }

            // Generate a new ref only for creation
            // Query for the highest ref in the same branch
            const lastOrder = await prisma.order.findFirst({
                where: { branchId: quotation.branchId },
                orderBy: { id: 'desc' }, // Sort by ref in descending order
            });

            let ref = "INV-";
            // Extract and increment the numeric part of the ref
            if (lastOrder && lastOrder.ref) {
                const refNumber = parseInt(lastOrder.ref.split('-')[1], 10) || 0;
                ref += String(refNumber + 1).padStart(5, '0'); // Increment and format with leading zeros
            } else {
                ref += "00001"; // Start from 00001 if no ref exists for the branch
            }

            // 2️ Create Order
            const order = await tx.order.create({
                data: {
                    branchId: quotation.branchId,
                    customerId: quotation.customerId,
                    ref,
                    orderDate: new Date(),
                    OrderSaleType: quotation.QuoteSaleType,
                    taxRate: quotation.taxRate,
                    taxNet: quotation.taxNet,
                    discount: quotation.discount,
                    shipping: quotation.shipping,
                    totalAmount: Number(quotation.grandTotal),
                    createdBy: req.user?.id ?? null,
                    createdAt: currentDate,
                    updatedAt: currentDate,
                    updatedBy: req.user?.id ?? null,
                    status: "APPROVED",

                    items: {
                        create: quotation.quotationDetails.map((item) => {
                            const base = {
                            ItemType: item.ItemType,
                            taxNet: Number(item.taxNet),
                            taxMethod: item.taxMethod,
                            discount: item.discount,
                            discountMethod: item.discountMethod,
                            total: Number(item.total),
                            quantity: item.quantity,
                            price: Number(item.cost),
                            };

                            // PRODUCT
                            if (item.ItemType === "PRODUCT") {
                                return {
                                    ...base,
                                    products: {
                                    connect: { id: item.productId! },
                                    },
                                    productvariants: {
                                    connect: { id: item.productVariantId! },
                                    },
                                };
                            }

                            // SERVICE
                            return {
                                ...base,
                                services: {
                                    connect: { id: item.serviceId! },
                                },
                            };
                        }),
                    },
                },
            });


            // 3️ Cut stock for PRODUCT items
            for (const item of quotation.quotationDetails) {
                if (item.ItemType !== "PRODUCT" || !item.productVariantId) continue;

                // Get stock row
                const stock = await tx.stocks.findUnique({
                    where: {
                        productVariantId_branchId: {
                            productVariantId: item.productVariantId,
                            branchId: quotation.branchId,
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
                        branchId: quotation.branchId,
                        type: "QUOATETOINV",
                        quantity: item.quantity,
                        note: `Order #${ref}`,
                        createdBy: req.user ? req.user.id : null,
                        createdAt: currentDate
                    },
                });
            }

            // 4️ Update quotation status
            await tx.quotations.update({
                where: { id: quotation.id },
                data: {
                    invoicedAt: currentDate,
                    invoicedBy: req.user ? req.user.id : null,
                    status: "INVOICED",
                },
            });

            return order;
        });
        res.status(201).json(result);
    } catch (error) {
        logger.error("Error converting quotation to order:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};