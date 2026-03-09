import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
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

const prisma = new PrismaClient();

export const getAllStockTransfer = async (req: Request, res: Response): Promise<void> => {
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
            branchRestriction = `AND stf."branchId" = ${loggedInUser.branchId}`;
        }

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "StockTransfers" stf
            LEFT JOIN "Branch" br ON stf."branchId" = br.id
            LEFT JOIN "Branch" tbr ON stf."toBranchId" = tbr.id
            LEFT JOIN "User" c ON stf."createdBy" = c.id
            LEFT JOIN "User" u ON stf."updatedBy" = u.id
            LEFT JOIN "User" ab ON stf."approvedBy" = ab.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    stf."StatusType"::text ILIKE $1
                    OR br."name" ILIKE $1
                    OR tbr."name" ILIKE $1
                    OR TO_CHAR(stf."transferDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // ----- 2) DATA FETCH -----
        const stockTransfer: any = await prisma.$queryRawUnsafe(`
            SELECT stf.*,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', tbr.id, 'name', tbr.name) AS "toBranch",
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                   json_build_object('id', ab.id, 'firstName', ab."firstName", 'lastName', ab."lastName") AS approver
            FROM "StockTransfers" stf
            LEFT JOIN "Branch" br ON stf."branchId" = br.id
            LEFT JOIN "Branch" tbr ON stf."toBranchId" = tbr.id
            LEFT JOIN "User" c ON stf."createdBy" = c.id
            LEFT JOIN "User" u ON stf."updatedBy" = u.id
            LEFT JOIN "User" ab ON stf."approvedBy" = ab.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    stf."StatusType"::text ILIKE $1
                    OR br."name" ILIKE $1
                    OR tbr."name" ILIKE $1
                    OR TO_CHAR(stf."transferDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(stf."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY stf."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: stockTransfer, total });

    } catch (error) {
        console.error("Error fetching transfer:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const upsertTransfer = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { fromBranchId, toBranchId, StatusType, note, transferDetails, transferDate } = req.body;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const loggedInUser = req.user;
            if (!loggedInUser) {
                res.status(401).json({ message: "User is not authenticated." });
                return;
            }

            if (Number(fromBranchId) === Number(toBranchId)) {
                throw new Error("From branch and To branch cannot be the same");
            }

            if (!transferDetails || !Array.isArray(transferDetails) || transferDetails.length === 0) {
                throw new Error("Transfer details cannot be empty");
            }

            const transferId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

            let oldTransfer: any = null;

            if (transferId) {
                oldTransfer = await tx.stockTransfers.findUnique({
                    where: { id: transferId },
                    include: {
                        transferDetails: true,
                    },
                });

                if (!oldTransfer) {
                    res.status(404).json({ message: "Transfer not found!" });
                    return;
                }

                if (oldTransfer.StatusType === "APPROVED") {
                    throw new Error("Approved transfer cannot be edited.");
                }

                if (oldTransfer.StatusType === "CANCELLED") {
                    throw new Error("Cancelled transfer cannot be edited.");
                }
            }

            for (const detail of transferDetails) {
                if (!detail.productVariantId) {
                    throw new Error("productVariantId is required in transfer details");
                }

                if (!detail.unitId) {
                    throw new Error("unitId is required in transfer details");
                }

                if (detail.unitQty == null || Number(detail.unitQty) <= 0) {
                    throw new Error("unitQty must be greater than 0");
                }

                if (detail.baseQty == null || Number(detail.baseQty) <= 0) {
                    throw new Error("baseQty must be greater than 0");
                }
            }

            let ref = "SRT-";

            if (!transferId) {
                const lastTransfer = await tx.stockTransfers.findFirst({
                    where: { branchId: Number(fromBranchId) },
                    orderBy: { id: "desc" },
                    select: { ref: true },
                });

                if (lastTransfer?.ref) {
                    const refNumber = parseInt(lastTransfer.ref.split("-")[1], 10) || 0;
                    ref += String(refNumber + 1).padStart(5, "0");
                } else {
                    ref += "00001";
                }
            }

            const transferPayload = {
                branchId: Number(fromBranchId),
                fromBranchId: Number(fromBranchId),
                toBranchId: Number(toBranchId),
                transferDate: new Date(dayjs(transferDate).format("YYYY-MM-DD")),
                StatusType,
                note,
                updatedAt: currentDate,
                updatedBy: loggedInUser.id,
                transferDetails: {
                    deleteMany: transferId ? { transferId } : undefined,
                    create: transferDetails.map((detail: any) => ({
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

            const transfer = transferId
                ? await tx.stockTransfers.update({
                    where: { id: transferId },
                    data: transferPayload,
                    include: {
                        transferDetails: true,
                    },
                })
                : await tx.stockTransfers.create({
                    data: {
                        ...transferPayload,
                        ref,
                        createdAt: currentDate,
                        createdBy: loggedInUser.id,
                    },
                    include: {
                        transferDetails: true,
                    },
                });

            if (StatusType === "APPROVED") {
                if (Number(fromBranchId) === Number(toBranchId)) {
                    throw new Error("From branch and To branch cannot be the same");
                }

                for (const detail of transfer.transferDetails) {
                    const baseQty = Number(detail.baseQty ?? 0);

                    if (baseQty <= 0) {
                        throw new Error("baseQty must be greater than 0");
                    }

                    // Check stock availability in source branch
                    const currentStock = await tx.stocks.findUnique({
                        where: {
                            productVariantId_branchId: {
                                productVariantId: Number(detail.productVariantId),
                                branchId: Number(fromBranchId),
                            },
                        },
                    });

                    const availableQty = Number(currentStock?.quantity ?? 0);

                    if (availableQty < baseQty) {
                        throw new Error(
                            `Insufficient stock for variant ID ${detail.productVariantId}. Available: ${availableQty}, Requested: ${baseQty}`
                        );
                    }

                    /* =========================
                       1) DECREASE FROM BRANCH
                    ========================== */
                    await tx.stocks.upsert({
                        where: {
                            productVariantId_branchId: {
                                productVariantId: Number(detail.productVariantId),
                                branchId: Number(fromBranchId),
                            },
                        },
                        update: {
                            quantity: { decrement: baseQty },
                            updatedBy: loggedInUser.id,
                            updatedAt: currentDate,
                        },
                        create: {
                            productVariantId: Number(detail.productVariantId),
                            branchId: Number(fromBranchId),
                            quantity: -baseQty,
                            createdBy: loggedInUser.id,
                            createdAt: currentDate,
                            updatedBy: loggedInUser.id,
                            updatedAt: currentDate,
                        },
                    });

                    await tx.stockMovements.create({
                        data: {
                            productVariantId: Number(detail.productVariantId),
                            branchId: Number(fromBranchId),
                            type: "TRANSFER",
                            status: "APPROVED",
                            quantity: new Decimal(-baseQty),
                            unitCost: null,
                            transferDetailId: detail.id,
                            note,
                            createdBy: loggedInUser.id,
                            createdAt: currentDate,
                            approvedAt: currentDate,
                            approvedBy: loggedInUser.id,
                        },
                    });

                    /* =========================
                       2) INCREASE TO BRANCH
                    ========================== */
                    await tx.stocks.upsert({
                        where: {
                            productVariantId_branchId: {
                                productVariantId: Number(detail.productVariantId),
                                branchId: Number(toBranchId),
                            },
                        },
                        update: {
                            quantity: { increment: baseQty },
                            updatedBy: loggedInUser.id,
                            updatedAt: currentDate,
                        },
                        create: {
                            productVariantId: Number(detail.productVariantId),
                            branchId: Number(toBranchId),
                            quantity: baseQty,
                            createdBy: loggedInUser.id,
                            createdAt: currentDate,
                            updatedBy: loggedInUser.id,
                            updatedAt: currentDate,
                        },
                    });

                    await tx.stockMovements.create({
                        data: {
                            productVariantId: Number(detail.productVariantId),
                            branchId: Number(toBranchId),
                            type: "TRANSFER",
                            status: "APPROVED",
                            quantity: new Decimal(baseQty),
                            unitCost: null,
                            transferDetailId: detail.id,
                            note,
                            createdBy: loggedInUser.id,
                            createdAt: currentDate,
                            approvedAt: currentDate,
                            approvedBy: loggedInUser.id,
                        },
                    });
                }

                await tx.stockTransfers.update({
                    where: { id: transfer.id },
                    data: {
                        StatusType: "APPROVED",
                        approvedAt: currentDate,
                        approvedBy: loggedInUser.id,
                    },
                });
            }

            return transfer;
        });

        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error creating/updating transfer:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getStockTransferById = async (
    req: Request,
    res: Response
): Promise<void> => {
    const { id } = req.params;
    const stockTransferId = id ? (Array.isArray(id) ? id[0] : id) : 0;

    try {
        const transfer = await prisma.stockTransfers.findUnique({
            where: { id: Number(stockTransferId) },
            include: {
                branch: true,
                creator: true,
                updater: true,
                transferDetails: {
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

        if (!transfer) {
            res.status(404).json({ message: "Stock transfer not found!" });
            return;
        }

        // use source branch stock for transfer edit form
        const branchId = transfer.fromBranchId ?? transfer.branchId;

        const variantIds = transfer.transferDetails
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

        transfer.transferDetails = transfer.transferDetails.map((detail: any) => {
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

                // base unit
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
                    // example: Roll -> Meter, multiplier 305, base = Meter
                    if (pv.baseUnitId === conv.toUnitId && conv.fromUnit) {
                        unitMap.set(conv.fromUnit.id, {
                            unitId: conv.fromUnit.id,
                            unitName: conv.fromUnit.name,
                            operationValue: Number(conv.multiplier ?? 1),
                            isBaseUnit: false,
                            operator: "*",
                        });
                    }

                    // reverse style conversion
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

        res.status(200).json(transfer);
    } catch (error) {
        console.error("Error fetching transfer by ID:", error);
        res.status(500).json({
            message: "Error fetching transfer by ID",
        });
    }
};

// export const getStockTransferById = async (req: Request, res: Response): Promise<void> => {
//     const { id } = req.params;
//     const transferId = id ? (Array.isArray(id) ? id[0] : id) : 0;
//     try {
//         const transfer = await prisma.stockTransfers.findUnique({
//             where: { id: Number(transferId) },
//             include: { 
//                 transferDetails: {
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

//         // Transform data to flatten `name` into `transferDetails`
//         if (transfer) {
//             transfer.transferDetails = transfer.transferDetails.map((detail: any) => ({
//                 ...detail,
//                 name: detail.productvariants.name, // Add `name` directly
//             }));
//         }

//         if (!transfer) {
//             res.status(404).json({ message: "Transfer not found!" });
//             return;
//         }
//         res.status(200).json(transfer);
//     } catch (error) {
//         logger.error("Error fetching transfer by ID:", error);
//         const typedError = error as Error;
//         res.status(500).json({ message: typedError.message });
//     }
// };

export const deleteTransfer = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const transferId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    const { delReason } = req.body;
    try {
        const transfer = await prisma.stockTransfers.findUnique({ 
            where: { id: Number(transferId) },
            include: { transferDetails: true } 
        });
        if (!transfer) {
            res.status(404).json({ message: "Transfer not found!" });
            return;
        }
        await prisma.stockTransfers.update({
            where: { id: Number(transferId) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason,
                StatusType: "CANCELLED"
            }
        });
        res.status(200).json(transfer);
    } catch (error) {
        logger.error("Error deleting transfer:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};