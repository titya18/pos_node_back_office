import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import logger from "../utils/logger";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { getQueryNumber, getQueryString } from "../utils/request";
import { Decimal } from "@prisma/client/runtime/library";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));


export const getAllStockRequests = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const rawSortField = getQueryString(req.query.sortField, "ref")!;
        const sortField = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawSortField) ? rawSortField : "ref";
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
            branchRestriction = `AND sr."branchId" = ${loggedInUser.branchId}`;
        }

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "StockRequests" sr
            LEFT JOIN "Branch" br ON sr."branchId" = br.id
            LEFT JOIN "User" c ON sr."createdBy" = c.id
            LEFT JOIN "User" u ON sr."updatedBy" = u.id
            LEFT JOIN "User" ab ON sr."approvedBy" = ab.id
            LEFT JOIN "User" rb ON sr."requestBy" = rb.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    sr."StatusType"::text ILIKE $1
                    OR rb."firstName" ILIKE $1
                    OR rb."lastName" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(sr."requestDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // ----- 2) DATA FETCH -----
        const stockAdjustment: any = await prisma.$queryRawUnsafe(`
            SELECT sr.*,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                   json_build_object('id', ab.id, 'firstName', ab."firstName", 'lastName', ab."lastName") AS approver,
                   json_build_object('id', rb.id, 'firstName', rb."firstName", 'lastName', rb."lastName") AS requester
            FROM "StockRequests" sr
            LEFT JOIN "Branch" br ON sr."branchId" = br.id
            LEFT JOIN "User" c ON sr."createdBy" = c.id
            LEFT JOIN "User" u ON sr."updatedBy" = u.id
            LEFT JOIN "User" ab ON sr."approvedBy" = ab.id
            LEFT JOIN "User" rb ON sr."requestBy" = rb.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    sr."StatusType"::text ILIKE $1
                    OR rb."firstName" ILIKE $1
                    OR rb."lastName" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(sr."requestDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY sr."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: stockAdjustment, total });

    } catch (error) {
        console.error("Error fetching stock request:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const upsertRequest = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { branchId, StatusType, note, requestDetails, requestDate } = req.body;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const loggedInUser = req.user;
            if (!loggedInUser) {
                res.status(401).json({ message: "User is not authenticated." });
                return;
            }

            const requestId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

            let oldRequest: any = null;

            if (requestId) {
                oldRequest = await tx.stockRequests.findUnique({
                    where: { id: requestId },
                    include: {
                        requestDetails: true,
                    },
                });

                if (!oldRequest) {
                    res.status(404).json({ message: "Request not found!" });
                    return;
                }

                if (oldRequest.StatusType === "APPROVED") {
                    throw new Error("Approved stock request cannot be edited.");
                }

                if (oldRequest.StatusType === "CANCELLED") {
                    throw new Error("Cancelled stock request cannot be edited.");
                }
            }

            if (!requestDetails || !Array.isArray(requestDetails) || requestDetails.length === 0) {
                throw new Error("Request details cannot be empty");
            }

            for (const detail of requestDetails) {
                if (!detail.productVariantId) {
                    throw new Error("productVariantId is required in request details");
                }

                if (!detail.unitId) {
                    throw new Error("unitId is required in request details");
                }

                if (detail.unitQty == null || Number(detail.unitQty) <= 0) {
                    throw new Error("unitQty must be greater than 0");
                }

                if (detail.baseQty == null || Number(detail.baseQty) <= 0) {
                    throw new Error("baseQty must be greater than 0");
                }
            }

            let ref = "SRQ-";

            if (!requestId) {
                const lastRequest = await tx.stockRequests.findFirst({
                    where: { branchId: Number(branchId) },
                    orderBy: { id: "desc" },
                    select: { ref: true },
                });

                if (lastRequest?.ref) {
                    const refNumber = parseInt(lastRequest.ref.split("-")[1], 10) || 0;
                    ref += String(refNumber + 1).padStart(5, "0");
                } else {
                    ref += "00001";
                }
            }

            const requestPayload = {
                branchId: Number(branchId),
                requestBy: req.user ? req.user.id : 0,
                requestDate: new Date(dayjs(requestDate).format("YYYY-MM-DD")),
                StatusType,
                note,
                updatedAt: currentDate,
                updatedBy: req.user ? req.user.id : null,
                requestDetails: {
                    deleteMany: requestId ? { requestId } : undefined,
                    create: requestDetails.map((detail: any) => ({
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

            const requestData = requestId
                ? await tx.stockRequests.update({
                    where: { id: requestId },
                    data: requestPayload,
                    include: {
                        requestDetails: true,
                    },
                })
                : await tx.stockRequests.create({
                    data: {
                        ...requestPayload,
                        ref,
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                    },
                    include: {
                        requestDetails: true,
                    },
                });

            if (StatusType === "APPROVED") {
                for (const detail of requestData.requestDetails) {
                    const baseQty = Number(detail.baseQty ?? 0);

                    if (baseQty <= 0) {
                        throw new Error("baseQty must be greater than 0");
                    }

                    // check stock availability first
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

                    const signedBaseQty = -baseQty;

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
                            type: "REQUEST",
                            status: "APPROVED",
                            quantity: new Decimal(signedBaseQty),
                            unitCost: null,
                            requestDetailId: detail.id,
                            note,
                            createdBy: req.user ? req.user.id : null,
                            createdAt: currentDate,
                            approvedAt: currentDate,
                            approvedBy: loggedInUser.id,
                        },
                    });
                }

                await tx.stockRequests.update({
                    where: { id: requestData.id },
                    data: {
                        StatusType: "APPROVED",
                        approvedAt: currentDate,
                        approvedBy: loggedInUser.id,
                    },
                });
            }

            return requestData;
        });

        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error creating/updating stock request:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getStockRequestById = async (
    req: Request,
    res: Response
): Promise<void> => {
    const { id } = req.params;
    const stockRequestId = id ? (Array.isArray(id) ? id[0] : id) : 0;

    try {
        const purchase = await prisma.stockRequests.findUnique({
            where: { id: Number(stockRequestId) },
            include: {
                branch: true,
                creator: true,
                updater: true,
                requestDetails: {
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

        const variantIds = purchase.requestDetails
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

        purchase.requestDetails = purchase.requestDetails.map((detail: any) => {
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
        console.error("Error fetching request by ID:", error);
        res.status(500).json({
            message: "Error fetching request by ID",
        });
    }
};

// export const getStockRequestById = async (req: Request, res: Response): Promise<void> => {
//     const { id } = req.params;
//     const stockRequestId = id ? (Array.isArray(id) ? id[0] : id) : 0;
//     try {
//         const requestData = await prisma.stockRequests.findUnique({
//             where: { id: Number(stockRequestId) },
//             include: { 
//                 requestDetails: {
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

//         // Transform data to flatten `name` into `requestDetails`
//         if (requestData) {
//             requestData.requestDetails = requestData.requestDetails.map((detail: any) => ({
//                 ...detail,
//                 name: detail.productvariants.name, // Add `name` directly
//             }));
//         }

//         if (!requestData) {
//             res.status(404).json({ message: "Stock request not found!" });
//             return;
//         }
//         res.status(200).json(requestData);
//     } catch (error) {
//         logger.error("Error fetching stock request by ID:", error);
//         const typedError = error as Error;
//         res.status(500).json({ message: typedError.message });
//     }
// };

export const deleteRequest = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const stockRequestId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    const { delReason } = req.body;
    try {
        const requestData = await prisma.stockRequests.findUnique({ 
            where: { id: Number(stockRequestId) },
            include: { requestDetails: true } 
        });
        if (!requestData) {
            res.status(404).json({ message: "Stock request not found!" });
            return;
        }
        await prisma.stockRequests.update({
            where: { id: Number(stockRequestId) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason,
                StatusType: "CANCELLED"
            }
        });
        res.status(200).json(requestData);
    } catch (error) {
        logger.error("Error deleting stock request:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};