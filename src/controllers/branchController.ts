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

export const getAllBranchesWithPagination = async (req: Request, res: Response): Promise<void> => {
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
            FROM "Branch" b
            LEFT JOIN "User" c ON b."createdBy" = c.id
            LEFT JOIN "User" u ON b."updatedBy" = u.id
            WHERE
                b."name" ILIKE $1
                OR b."address" ILIKE $1
                OR TO_CHAR(b."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const branches: any = await prisma.$queryRawUnsafe(`
            SELECT b.*, 
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "Branch" b
            LEFT JOIN "User" c ON b."createdBy" = c.id
            LEFT JOIN "User" u ON b."updatedBy" = u.id
            WHERE
                b."name" ILIKE $1
                OR b."address" ILIKE $1
                OR TO_CHAR(b."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            ORDER BY b."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: branches, total });

    } catch (error) {
        logger.error("Error fetching branches:", error);
        res.status(500).json({ message: (error as Error).message });
    }
};

export const getAllBranches = async (req: Request, res: Response): Promise<void> => {
    try {
        const branches = await prisma.branch.findMany();
        res.status(200).json(branches);
    } catch (error) {
        logger.error("Error fetching branches:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getBranchById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const branch = await prisma.branch.findUnique({
            where: { id: parseInt(id, 10) }
        });

        if (branch) {
            res.status(200).json(branch);
        } else {
            res.status(404).json({ message: "Branch not found" });
        }
    } catch (error) {
        logger.error("Error fetching branch by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}

export const upsertBranch = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, address } = req.body;
    try {
        const restult = await prisma.$transaction(async (prisma) => {
            const branchId = id ? parseInt(id, 10) : undefined;
            if (branchId) {
                const checkBranch = await prisma.branch.findUnique({ where: { id: branchId } });
                if (!checkBranch) {
                    res.status(404).json({ message: "Branch not found" });
                }
            }

            const checkExisting = await prisma.branch.findFirst({ 
                where: {
                    name,
                    id: { not: branchId }
                }
            });
            if (checkExisting) {
                res.status(400).json({ message: "Branch name must be unique" });
                return;
            }
            const branch = id
                ? await prisma.branch.update({
                    where: { id: branchId },
                    data: {
                        name,
                        address,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await prisma.branch.create({
                    data: {
                        name,
                        address,
                        createdAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                });
            return branch;
        });

        res.status(id ? 200 : 201).json(restult);
    } catch (error) {
        logger.error("Error upserting branch:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}