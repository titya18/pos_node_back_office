import { Request, Response } from 'express';
import { DateTime } from "luxon";
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
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

export const upsertVariantAttribute = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, values } = req.body;
    const currentDate = new Date();

    try {
        const result = await prisma.$transaction(async (prisma) => {
            const variantAttributeId = id ? (Array.isArray(id) ? id[0] : id) : 0;

            // ============================
            // FETCH EXISTING DATA
            // ============================
            let existingValues: any[] = [];

            if (variantAttributeId) {
                const data = await prisma.variantAttribute.findUnique({
                    where: { id: Number(variantAttributeId) },
                    include: { values: true }
                });

                if (!data) {
                    res.status(404).json({ message: "Variant Attribute not found" });
                    return;
                }

                existingValues = data.values;
            }

            // Convert client values → ["XL", "Red", ...]
            const newValues = values?.map((v: any) => v.value) || [];

            // ============================
            // CHECK UNIQUE NAME
            // ============================
            const checkName = await prisma.variantAttribute.findFirst({
                where: { name, id: { not: Number(variantAttributeId) } }
            });

            if (checkName) {
                res.status(400).json({ message: "Variant Attribute name must be unique" });
                return;
            }

            // ============================
            // FIND VALUES TO DELETE
            // ============================
            const valuesToDelete = existingValues.filter(v => !newValues.includes(v.value));

            // ============================
            // CHECK FOR FOREIGN KEY USAGE
            // ============================
            for (const v of valuesToDelete) {
                const used = await prisma.productVariantValues.findFirst({
                    where: { variantValueId: v.id }
                });

                if (used) {
                    res.status(400).json({
                        message: `Value "${v.value}" cannot be deleted because it's used in product variants.`,
                        value: v.value
                    });
                    return;
                }
            }

            // ============================
            // DELETE SAFE VALUES
            // ============================
            await prisma.variantValue.deleteMany({
                where: {
                    id: { in: valuesToDelete.map(v => v.id) }
                }
            });

            // ============================
            // UPSERT NEW VALUES
            // ============================
            let updatedAttribute;

            if (variantAttributeId) {
                updatedAttribute = await prisma.variantAttribute.update({
                    where: { id: Number(variantAttributeId) },
                    data: {
                        name,
                        updatedAt: currentDate,
                        updatedBy: req.user?.id ?? null,

                        // Delete ONLY safe values & create new ones
                        values: {
                            create: newValues
                                .filter((v: string) => !existingValues.some(ev => ev.value === v))
                                .map((v: string) => ({ value: v }))
                        }
                    },
                    include: { values: true }
                });
            } else {
                // NEW ATTRIBUTE
                updatedAttribute = await prisma.variantAttribute.create({
                    data: {
                        name,
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user?.id ?? null,
                        updatedBy: req.user?.id ?? null,
                        values: {
                            create: newValues.map((v: string) => ({ value: v }))
                        }
                    },
                    include: { values: true }
                });
            }
            return updatedAttribute;
        });

        res.status(200).json(result);

    } catch (error) {
        logger.error("Error upserting variant attribute:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};


// Get All Variant Attributes
export const getAllVariantAttributesWithPagination = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "name")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";
        const offset = (pageNumber - 1) * pageSize;

        const likeTerm = `%${searchTerm}%`;

        // Split words: "Lorn Titya" → ["Lorn", "Titya"]
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        // Dynamic conditions for creator/updater names
        const fullNameConditions = searchWords
            .map((_, idx) => `
                (
                    c."firstName" ILIKE $${idx + 2} OR c."lastName" ILIKE $${idx + 2}
                    OR u."firstName" ILIKE $${idx + 2} OR u."lastName" ILIKE $${idx + 2}
                )
            `)
            .join(" AND ");

        const params = [likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // -------------------------
        // 1. COUNT TOTAL
        // -------------------------
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "VariantAttribute" va
            LEFT JOIN "User" c ON va."createdBy" = c.id
            LEFT JOIN "User" u ON va."updatedBy" = u.id
            WHERE va."deletedAt" IS NULL
              AND (
                    va."name" ILIKE $1
                OR  TO_CHAR(va."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR  TO_CHAR(va."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR  TO_CHAR(va."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR  TO_CHAR(va."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
              )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // -------------------------
        // 2. GET PAGINATED DATA
        // -------------------------
        const attributes: any = await prisma.$queryRawUnsafe(`
            SELECT 
                va.*,
                json_build_object(
                    'id', c.id, 
                    'firstName', c."firstName", 
                    'lastName', c."lastName"
                ) AS creator,
                json_build_object(
                    'id', u.id, 
                    'firstName', u."firstName", 
                    'lastName', u."lastName"
                ) AS updater
            FROM "VariantAttribute" va
            LEFT JOIN "User" c ON va."createdBy" = c.id
            LEFT JOIN "User" u ON va."updatedBy" = u.id
            WHERE va."deletedAt" IS NULL
              AND (
                    va."name" ILIKE $1
                OR  TO_CHAR(va."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR  TO_CHAR(va."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR  TO_CHAR(va."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR  TO_CHAR(va."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
              )
            ORDER BY va."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        // -------------------------
        // 3. LOAD VALUES FOR EACH ATTRIBUTE (VariantValues)
        // -------------------------
        const attributeIds = attributes.map((a: any) => a.id);

        let valuesMap: Record<number, any[]> = {};

        if (attributeIds.length > 0) {
            const values: any[] = await prisma.$queryRawUnsafe(`
                SELECT 
                    vv.*,
                    vv."variantAttributeId"
                FROM "VariantValue" vv
                WHERE vv."variantAttributeId" = ANY($1)
            `, attributeIds);

            values.forEach(v => {
                if (!valuesMap[v.variantAttributeId]) valuesMap[v.variantAttributeId] = [];
                valuesMap[v.variantAttributeId].push(v);
            });
        }

        // -------------------------
        // 4. FORMAT FINAL RESPONSE
        // -------------------------
        const data = attributes.map((attr: any) => ({
            ...attr,
            values: valuesMap[attr.id] || []
        }));

        res.status(200).json({ data, total });

    } catch (error) {
        logger.error("Error fetching variant attributes:", error);
        res.status(500).json({ message: (error as Error).message });
    }
};

// Get All Variant Attributes
export const getAllVariantAttributes = async (req: Request, res: Response): Promise<void> => {
    try {
        const variantAttributes = await prisma.variantAttribute.findMany({
            where: { deletedAt: null },
            include: { values: true }
        });
        res.status(200).json(variantAttributes);
    } catch (error) {
        logger.error("Error fetching variant attributes:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

// Get Module by ID
export const getVariantAttributeById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const attributeId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    try {
        const variantAttribute = await prisma.variantAttribute.findUnique({
            where: { id: Number(attributeId) },
            include: { values: true }
        });

        if (variantAttribute) {
            res.status(200).json(variantAttribute);
        } else {
            res.status(404).json({ message: 'Variant Attribute not found' });
        }
    } catch (error) {
        logger.error("Error fetching variant attribute by ID:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

// Delete a Module
export const deleteVariantAttribute = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const attributeId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    try {

        // Delete VariantValues first
        await prisma.variantValue.deleteMany({
        where: { variantAttributeId: Number(attributeId) }
        });

        // Then delete the VariantAttribute
        await prisma.variantAttribute.update({
            where: { id: Number(attributeId) },
            data: { deletedAt: currentDate, deletedBy: req.user ? req.user.id : null }
        });

        res.status(204).end(); // No Content
    } catch (error) {
        logger.error("Error deleting variant attribute:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};