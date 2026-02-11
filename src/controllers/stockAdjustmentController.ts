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
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "desc" : "asc";
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
            const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
            // Verify that loggedInUser is defined
            if (!loggedInUser) {
                res.status(401).json({ message: "User is not authenticated." });
                return;
            }

            const adjustmentId = id ? parseInt(id, 10) : undefined;
            if (adjustmentId) {
                const checkStockAdjustment = await tx.stockAdjustments.findUnique({ where: { id: adjustmentId } });
                if (!checkStockAdjustment) {
                    res.status(404).json({ message: "Adjustment not found!" });
                    return;
                }
            }

            if (!adjustmentDetails || adjustmentDetails.length === 0) {
                throw new Error("Adjustment details cannot be empty");
            }

            let ref = "SAJM-";

            // Generate a new ref only for creation
            if (!id) {
                // Query for the highest ref in the same branch
                const lastAdjustment = await prisma.stockAdjustments.findFirst({
                    where: { branchId: parseInt(branchId, 10) },
                    orderBy: { id: 'desc' }, // Sort by ref in descending order
                });

                // Extract and increment the numeric part of the ref
                if (lastAdjustment && lastAdjustment.ref) {
                    const refNumber = parseInt(lastAdjustment.ref.split('-')[1], 10) || 0;
                    ref += String(refNumber + 1).padStart(5, '0'); // Increment and format with leading zeros
                } else {
                    ref += "00001"; // Start from 00001 if no ref exists for the branch
                }
            }

            const adjustment = adjustmentId
                ? await tx.stockAdjustments.update({
                    where: { id: adjustmentId },
                    data: {
                        branchId: parseInt(branchId, 10),
                        adjustDate: new Date(dayjs(adjustDate).format("YYYY-MM-DD")),
                        AdjustMentType,
                        StatusType,
                        note,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null,
                        adjustmentDetails: {
                            deleteMany: {
                                adjustmentId: adjustmentId   // MUST include a filter
                            }, // Delete existing adjustment details
                            create: adjustmentDetails.map((detail: any) => ({
                                productId: parseInt(detail.productId, 10),
                                productVariantId: parseInt(detail.productVariantId, 10),
                                quantity: parseInt(detail.quantity, 10),
                            })),
                        },
                    }
                })
                : await tx.stockAdjustments.create({
                    data: {
                        branchId: parseInt(branchId, 10),
                        ref,
                        note,
                        adjustDate: new Date(dayjs(adjustDate).format("YYYY-MM-DD")),
                        AdjustMentType,
                        StatusType,
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null,
                        adjustmentDetails: {
                            create: adjustmentDetails.map((detail: any) => ({
                                productId: parseInt(detail.productId, 10),
                                productVariantId: parseInt(detail.productVariantId, 10),
                                quantity: parseInt(detail.quantity, 10),
                            })),
                        },
                    }
                });
            
            // If status is Received update stock
            if (StatusType === "APPROVED") {
                for (const detail of adjustmentDetails) {
                    // Determine signed quantity for adjustment
                    const signedQuantity = AdjustMentType === 'POSITIVE' ? Number(detail.quantity) : -Number(detail.quantity);

                    // Update or create stock
                     await tx.stocks.upsert({
                        where: {
                            productVariantId_branchId: {
                                productVariantId: Number(detail.productVariantId),
                                branchId: Number(branchId),
                            },
                        },
                        update: {
                            quantity: { increment: signedQuantity },
                            updatedBy: loggedInUser.id,
                            updatedAt: currentDate
                        },
                        create: {
                            productVariantId: Number(detail.productVariantId),
                            branchId: Number(branchId),
                            quantity: signedQuantity,
                            createdBy: loggedInUser.id,
                            createdAt: currentDate
                        },
                    });

                    // Insert stock movement
                    await tx.stockMovements.create({
                        data: {
                            productVariantId: Number(detail.productVariantId),
                            branchId: Number(branchId),
                            type: "ADJUSTMENT",
                            status: 'APPROVED',
                            quantity: signedQuantity,
                            note,
                            createdBy: req.user ? req.user.id : null,
                            createdAt: currentDate
                        },
                    });
                }

                await tx.stockAdjustments.update({
                    where: { id: adjustment.id },
                    data: {
                        StatusType: "APPROVED",
                        approvedAt: currentDate,
                        approvedBy: loggedInUser.id
                    }
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

export const getStockAdjustmentById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const adjustment = await prisma.stockAdjustments.findUnique({
            where: { id: parseInt(id, 10) },
            include: { 
                adjustmentDetails: {
                    include: {
                        products: true, // Include related products data
                        productvariants: {
                            select: {
                                name: true, // Select the `name` field from `productVariant`
                                barcode: true,
                                sku: true
                            },
                        },
                    },
                },
                branch: true, // Include related branch data
            },
        });

        // Transform data to flatten `name` into `adjustDetails`
        if (adjustment) {
            adjustment.adjustmentDetails = adjustment.adjustmentDetails.map((detail: any) => ({
                ...detail,
                name: detail.productvariants.name, // Add `name` directly
            }));
        }

        if (!adjustment) {
            res.status(404).json({ message: "Adjustment not found!" });
            return;
        }
        res.status(200).json(adjustment);
    } catch (error) {
        logger.error("Error fetching adjustment by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteAdjustment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { delReason } = req.body;
    try {
        const adjustment = await prisma.stockAdjustments.findUnique({ 
            where: { id: parseInt(id, 10) },
            include: { adjustmentDetails: true } 
        });
        if (!adjustment) {
            res.status(404).json({ message: "Adjustment not found!" });
            return;
        }
        await prisma.stockAdjustments.update({
            where: { id: parseInt(id, 10) },
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