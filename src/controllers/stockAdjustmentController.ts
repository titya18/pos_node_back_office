import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../utils/logger";
import { Decimal } from "@prisma/client/runtime/library"
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

export const getAllStockAdjustments = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "ref")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "asc" : "desc";
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
                 OR br."name" ILIKE $${idx + 2})
            `)
            .join(" AND ");

        // Build parameters: $1 = likeTerm, $2..$n = searchword, $n+1 = limit, $n+2 = offset
        const params = [likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // Branch restriction
        let branchRestriction = "";
        if (loggedInUser.roleType === "USER" && loggedInUser.branchId) {
            branchRestriction = `AND sam."branchId" = ${loggedInUser.branchId}`;
        }

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "StockAdjustments" sam
            LEFT JOIN "Branch" br ON sam."branchId" = br.id
            LEFT JOIN "User" c ON sam."createdBy" = c.id
            LEFT JOIN "User" u ON sam."updatedBy" = u.id
            LEFT JOIN "User" ab ON sam."approvedBy" = ab.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    sam."AdjustMentType"::text ILIKE $1
                    OR sam."StatusType"::text ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(sam."adjustDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // ----- 2) DATA FETCH -----
        const stockAdjustment: any = await prisma.$queryRawUnsafe(`
            SELECT sam.*,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                   json_build_object('id', ab.id, 'firstName', ab."firstName", 'lastName', ab."lastName") AS approver
            FROM "StockAdjustments" sam
            LEFT JOIN "Branch" br ON sam."branchId" = br.id
            LEFT JOIN "User" c ON sam."createdBy" = c.id
            LEFT JOIN "User" u ON sam."updatedBy" = u.id
            LEFT JOIN "User" ab ON sam."approvedBy" = ab.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    sam."AdjustMentType"::text ILIKE $1
                    OR sam."StatusType"::text ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(sam."adjustDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sam."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY sam."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: stockAdjustment, total });

    } catch (error) {
        console.error("Error fetching adjustment:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const upsertAdjustment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { branchId, AdjustMentType, StatusType, note, adjustmentDetails, adjustDate } = req.body;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const loggedInUser = req.user;
            if (!loggedInUser) {
                res.status(401).json({ message: "User is not authenticated." });
                return;
            }

            const adjustmentId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

            let oldAdjustment: any = null;

            if (adjustmentId) {
                oldAdjustment = await tx.stockAdjustments.findUnique({
                    where: { id: adjustmentId },
                    include: {
                        adjustmentDetails: true,
                    },
                });

                if (!oldAdjustment) {
                    res.status(404).json({ message: "Adjustment not found!" });
                    return;
                }

                if (oldAdjustment.StatusType === "APPROVED") {
                    throw new Error("Approved stock adjustment cannot be edited.");
                }

                if (oldAdjustment.StatusType === "CANCELLED") {
                    throw new Error("Cancelled stock adjustment cannot be edited.");
                }
            }

            if (!adjustmentDetails || !Array.isArray(adjustmentDetails) || adjustmentDetails.length === 0) {
                throw new Error("Adjustment details cannot be empty");
            }

            // Validate details
            for (const detail of adjustmentDetails) {
                if (!detail.productVariantId) {
                    throw new Error("productVariantId is required in adjustment details");
                }

                if (!detail.unitId) {
                    throw new Error("unitId is required in adjustment details");
                }

                if (detail.unitQty == null || Number(detail.unitQty) <= 0) {
                    throw new Error("unitQty must be greater than 0");
                }

                if (detail.baseQty == null || Number(detail.baseQty) <= 0) {
                    throw new Error("baseQty must be greater than 0");
                }
            }

            let ref = "SAJM-";

            if (!adjustmentId) {
                const lastAdjustment = await tx.stockAdjustments.findFirst({
                    where: { branchId: Number(branchId) },
                    orderBy: { id: "desc" },
                    select: { ref: true },
                });

                if (lastAdjustment?.ref) {
                    const refNumber = parseInt(lastAdjustment.ref.split("-")[1], 10) || 0;
                    ref += String(refNumber + 1).padStart(5, "0");
                } else {
                    ref += "00001";
                }
            }

            const adjustmentPayload = {
                branchId: Number(branchId),
                adjustDate: new Date(dayjs(adjustDate).format("YYYY-MM-DD")),
                AdjustMentType,
                StatusType,
                note,
                updatedAt: currentDate,
                updatedBy: loggedInUser.id,
                adjustmentDetails: {
                    deleteMany: adjustmentId ? { adjustmentId } : undefined,
                    create: adjustmentDetails.map((detail: any) => ({
                        productId: detail.productId ? Number(detail.productId) : null,
                        productVariantId: Number(detail.productVariantId),
                        unitId: Number(detail.unitId),
                        unitQty: new Decimal(detail.unitQty ?? 0),
                        baseQty: new Decimal(detail.baseQty ?? 0),

                        // optional legacy field
                        quantity: Math.round(Number(detail.baseQty ?? 0)),
                    })),
                },
            };

            const adjustment = adjustmentId
                ? await tx.stockAdjustments.update({
                    where: { id: adjustmentId },
                    data: adjustmentPayload,
                    include: {
                        adjustmentDetails: true,
                    },
                })
                : await tx.stockAdjustments.create({
                    data: {
                        ...adjustmentPayload,
                        ref,
                        createdAt: currentDate,
                        createdBy: loggedInUser.id,
                    },
                    include: {
                        adjustmentDetails: true,
                    },
                });

            // Only post stock when APPROVED
            if (StatusType === "APPROVED") {
                for (const detail of adjustment.adjustmentDetails) {
                    const baseQty = Number(detail.baseQty ?? 0);

                    if (baseQty <= 0) {
                        throw new Error("baseQty must be greater than 0");
                    }

                    const signedBaseQty =
                        AdjustMentType === "POSITIVE" ? baseQty : -baseQty;

                    // Prevent negative stock if adjustment is NEGATIVE
                    if (AdjustMentType === "NEGATIVE") {
                        const currentStock = await tx.stocks.findUnique({
                            where: {
                                productVariantId_branchId: {
                                    productVariantId: Number(detail.productVariantId),
                                    branchId: Number(branchId),
                                },
                            },
                        });

                        const availableQty = Number(currentStock?.quantity ?? 0);

                        if (availableQty < baseQty) {
                            throw new Error(
                                `Insufficient stock for variant ID ${detail.productVariantId}. Available: ${availableQty}, Requested: ${baseQty}`
                            );
                        }
                    }

                    await tx.stocks.upsert({
                        where: {
                            productVariantId_branchId: {
                                productVariantId: Number(detail.productVariantId),
                                branchId: Number(branchId),
                            },
                        },
                        update: {
                            quantity: { increment: signedBaseQty },
                            updatedBy: loggedInUser.id,
                            updatedAt: currentDate,
                        },
                        create: {
                            productVariantId: Number(detail.productVariantId),
                            branchId: Number(branchId),
                            quantity: signedBaseQty,
                            createdBy: loggedInUser.id,
                            createdAt: currentDate,
                            updatedBy: loggedInUser.id,
                            updatedAt: currentDate,
                        },
                    });

                    await tx.stockMovements.create({
                        data: {
                            productVariantId: Number(detail.productVariantId),
                            branchId: Number(branchId),
                            type: "ADJUSTMENT",
                            AdjustMentType,
                            status: "APPROVED",
                            quantity: new Decimal(signedBaseQty),

                            // adjustment normally has no purchase cost source
                            // keep null or 0 depending on your system design
                            unitCost: null,

                            adjustmentDetailId: detail.id,
                            note,
                            createdBy: loggedInUser.id,
                            createdAt: currentDate,
                            approvedAt: currentDate,
                            approvedBy: loggedInUser.id,
                        },
                    });
                }

                await tx.stockAdjustments.update({
                    where: { id: adjustment.id },
                    data: {
                        StatusType: "APPROVED",
                        approvedAt: currentDate,
                        approvedBy: loggedInUser.id,
                    },
                });
            }

            return adjustment;
        });

        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error creating/updating adjustment:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getStockAdjustmentById = async (
    req: Request,
    res: Response
): Promise<void> => {
    const { id } = req.params;
    const stockAdjustmentId = id ? (Array.isArray(id) ? id[0] : id) : 0;

    try {
        const purchase = await prisma.stockAdjustments.findUnique({
            where: { id: Number(stockAdjustmentId) },
            include: {
                branch: true,
                creator: true,
                updater: true,
                adjustmentDetails: {
                    include: {
                        unit: true,
                        products: true,
                        productvariants: {
                            select: {
                                id: true,
                                productId: true,
                                name: true,
                                barcode: true,
                                sku: true,
                                productType: true,
                                baseUnitId: true,
                                baseUnit: {
                                    select: {
                                        id: true,
                                        name: true,
                                        type: true,
                                    },
                                },
                                products: {
                                    select: {
                                        id: true,
                                        name: true,
                                        unitConversions: {
                                            select: {
                                                id: true,
                                                productId: true,
                                                fromUnitId: true,
                                                toUnitId: true,
                                                multiplier: true,
                                                fromUnit: {
                                                    select: {
                                                        id: true,
                                                        name: true,
                                                        type: true,
                                                    },
                                                },
                                                toUnit: {
                                                    select: {
                                                        id: true,
                                                        name: true,
                                                        type: true,
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!purchase) {
            res.status(404).json({ message: "Stock adjustment not found!" });
            return;
        }

        const branchId = purchase.branchId;

        const variantIds = purchase.adjustmentDetails
            .map((detail) => detail.productVariantId)
            .filter((id): id is number => id !== null);

        const stocks = await prisma.stocks.findMany({
            where: {
                branchId,
                productVariantId: {
                    in: variantIds,
                },
            },
            select: {
                productVariantId: true,
                quantity: true,
            },
        });

        const stockMap = new Map<number, number>(
            stocks.map((s) => [s.productVariantId, Number(s.quantity)])
        );

        purchase.adjustmentDetails = purchase.adjustmentDetails.map((detail: any) => {
            const pv = detail.productvariants;

            let unitOptions: any[] = [];

            if (pv) {
                const unitMap = new Map<
                    number,
                    {
                        unitId: number;
                        unitName: string;
                        operationValue: number;
                        isBaseUnit: boolean;
                        operator?: string;
                    }
                >();

                if (pv.baseUnit) {
                    unitMap.set(pv.baseUnit.id, {
                        unitId: pv.baseUnit.id,
                        unitName: pv.baseUnit.name,
                        operationValue: 1,
                        isBaseUnit: true,
                        operator: "*",
                    });
                }

                const conversions = pv.products?.unitConversions ?? [];

                for (const conv of conversions) {
                    if (pv.baseUnitId === conv.toUnitId && conv.fromUnit) {
                        unitMap.set(conv.fromUnit.id, {
                            unitId: conv.fromUnit.id,
                            unitName: conv.fromUnit.name,
                            operationValue: Number(conv.multiplier ?? 1),
                            isBaseUnit: false,
                            operator: "*",
                        });
                    }

                    if (pv.baseUnitId === conv.fromUnitId && conv.toUnit) {
                        const multiplier = Number(conv.multiplier ?? 1);

                        unitMap.set(conv.toUnit.id, {
                            unitId: conv.toUnit.id,
                            unitName: conv.toUnit.name,
                            operationValue: multiplier === 0 ? 1 : 1 / multiplier,
                            isBaseUnit: false,
                            operator: "*",
                        });
                    }
                }

                unitOptions = Array.from(unitMap.values());
            }

            return {
                ...detail,
                productvariants: pv
                    ? {
                          ...pv,
                          unitOptions,
                      }
                    : null,
                name: detail.productvariants?.name,
                barcode: detail.productvariants?.barcode,
                sku: detail.productvariants?.sku,
                stocks: stockMap.get(detail.productVariantId) ?? 0,
            };
        });

        res.status(200).json(purchase);
    } catch (error) {
        console.error("Error fetching adjustment by ID:", error);
        res.status(500).json({
            message: "Error fetching adjustment by ID",
        });
    }
};

// export const getStockAdjustmentById = async (req: Request, res: Response): Promise<void> => {
//     const { id } = req.params;
//     const stockAdjustmentId = id ? (Array.isArray(id) ? id[0] : id) : 0;
//     try {
//         const adjustment = await prisma.stockAdjustments.findUnique({
//             where: { id: Number(stockAdjustmentId) },
//             include: { 
//                 adjustmentDetails: {
//                     include: {
//                         products: true, // Include related products data
//                         productvariants: {
//                             select: {
//                                 name: true, // Select the `name` field from `productVariant`
//                                 barcode: true,
//                                 sku: true
//                             },
//                         },
//                     },
//                 },
//                 branch: true, // Include related branch data
//             },
//         });

//         // Transform data to flatten `name` into `adjustDetails`
//         if (adjustment) {
//             adjustment.adjustmentDetails = adjustment.adjustmentDetails.map((detail: any) => ({
//                 ...detail,
//                 name: detail.productvariants.name, // Add `name` directly
//             }));
//         }

//         if (!adjustment) {
//             res.status(404).json({ message: "Adjustment not found!" });
//             return;
//         }
//         res.status(200).json(adjustment);
//     } catch (error) {
//         logger.error("Error fetching adjustment by ID:", error);
//         const typedError = error as Error;
//         res.status(500).json({ message: typedError.message });
//     }
// };

export const deleteAdjustment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const stockAdjustmentId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    const { delReason } = req.body;
    try {
        const adjustment = await prisma.stockAdjustments.findUnique({ 
            where: { id: Number(stockAdjustmentId) },
            include: { adjustmentDetails: true } 
        });
        if (!adjustment) {
            res.status(404).json({ message: "Adjustment not found!" });
            return;
        }
        await prisma.stockAdjustments.update({
            where: { id: Number(stockAdjustmentId) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason,
                StatusType: "CANCELLED"
            }
        });
        res.status(200).json(adjustment);
    } catch (error) {
        logger.error("Error deleting adjustment:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};