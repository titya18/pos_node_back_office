import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

const prisma = new PrismaClient();

export const getAllUnitsWithPagination = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
        const offset = (pageNumber - 1) * pageSize;

        // Base LIKE term for simple fields
        const likeTerm = `%${searchTerm}%`;

        // Split search term into words for full name search
        const searchWords = searchTerm.split(/\s+/).filter(Boolean); // ["Lorn", "Titya"]

        // Build full name conditions dynamically
        const fullNameConditions = searchWords
            .map((_, idx) => `
                (c."firstName" ILIKE $${idx + 2} OR c."lastName" ILIKE $${idx + 2}
                 OR u."firstName" ILIKE $${idx + 2} OR u."lastName" ILIKE $${idx + 2})
            `)
            .join(" AND ");

        // Build parameters: $1 = likeTerm, $2..$n = search words, $n+1 = limit, $n+2 = offset
        const params = [likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // 1️ Count total
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Units" un
            LEFT JOIN "User" c ON un."createdBy" = c.id
            LEFT JOIN "User" u ON un."updatedBy" = u.id
            WHERE
                un."name" ILIKE $1
                OR un."type"::text ILIKE $1
                OR TO_CHAR(un."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(un."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(un."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(un."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const units: any = await prisma.$queryRawUnsafe(`
            SELECT un.*, 
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "Units" un
            LEFT JOIN "User" c ON un."createdBy" = c.id
            LEFT JOIN "User" u ON un."updatedBy" = u.id
            WHERE
                un."name" ILIKE $1
                OR un."type"::text ILIKE $1
                OR TO_CHAR(un."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(un."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(un."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(un."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            ORDER BY un."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: units, total });

    } catch (error) {
        logger.error("Error fetching units:", error);
        const typedError = error as Error; 
        res.status(500).json({ message: typedError.message });
    }
};

export const getAllUnits = async (req: Request, res: Response): Promise<void> => {
    try {
        const units = await prisma.units.findMany(
            { where: { deletedAt: null } }
        );
        res.status(200).json(units);
    } catch (error) {
        logger.error("Error fetching all units:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertUnit = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, type } = req.body;

    try {
        const result = await prisma.$transaction(async (prisma) => {
            const unitId = id ? parseInt(id, 10) : undefined;
            if (unitId) {
                const checkUnit = await prisma.units.findUnique({ where: { id: unitId } });
                if (!checkUnit) {
                    res.status(404).json({ message: "Unit not found!" });
                    return;
                }
            }

            const checkExisting = await prisma.units.findFirst({
                where: {
                    name,
                    id: { not: unitId }
                }
            });
            if (checkExisting) {
                res.status(400).json({ message: "Unit's name must be unique" });
                return;
            }

            const unit = id
                ? await prisma.units.update({
                    where: { id: unitId },
                    data: {
                        name,
                        type,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await prisma.units.create({
                    data: {
                        name,
                        type,
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null
                    }
                });

            return unit;
        });
        
        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error upserting unit:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getUnitById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const unit = await prisma.units.findUnique({
            where: { id: parseInt(id, 10) }
        });
        if (!unit) {
            res.status(404).json({ message: "Unit not found!" });
            return;
        }
        res.status(200).json(unit);
    } catch (error) {
        logger.error("Error fetching unit by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteUnit = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    try {
        const unit = await prisma.units.findUnique({
            where: { id: parseInt(id, 10) }
        });
        if (!unit) {
            res.status(404).json({ message: "Unit not found!" });
            return;
        }
        await prisma.units.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null
            }
        });
        res.status(200).json(unit);
    } catch (error) {
        logger.error("Error deleting unit:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}