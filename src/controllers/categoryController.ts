import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
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

export const getAllCategoriesWithPagination = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "name")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";
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
            FROM "Categories" cg
            LEFT JOIN "User" c ON cg."createdBy" = c.id
            LEFT JOIN "User" u ON cg."updatedBy" = u.id
            WHERE
                cg."name" ILIKE $1
                OR TO_CHAR(cg."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cg."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cg."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cg."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const categories: any = await prisma.$queryRawUnsafe(`
            SELECT cg.*, 
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "Categories" cg
            LEFT JOIN "User" c ON cg."createdBy" = c.id
            LEFT JOIN "User" u ON cg."updatedBy" = u.id
            WHERE
                cg."name" ILIKE $1
                OR TO_CHAR(cg."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cg."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cg."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cg."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            ORDER BY cg."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: categories, total });

    } catch (error) {
        logger.error("Error fetching categories:", error);
        const TypeError = error as Error;
        res.status(500).json({ message: TypeError.message });
    }
};

export const getAllCategories = async (req: Request, res: Response): Promise<void> => {
    try {
        const categories = await prisma.categories.findMany(
            {
                where: {
                    deletedAt: null
                }
            }
        );
        res.status(200).json(categories);
    } catch (error) {
        logger.error("Error fetching categories:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertCategory = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { code, name } = req.body;
    
    try {
        const restult = await prisma.$transaction(async (prisma) => {
            const categoryId = id ? parseInt(id, 10) : undefined;
            if (categoryId) {
                const checkCategory = await prisma.categories.findUnique({ where: { id: categoryId } });
                if (!checkCategory) {
                    res.status(404).json({ message: "Category not found!" });
                    return;
                }
            }

            const checkExisting = await prisma.categories.findFirst({
                where: {
                    code,
                    id: { not: categoryId }
                }
            });
            if (checkExisting) {
                res.status(400).json({ message: "Category's code must be unique" });
                return;
            }

            const category = id
                ? await prisma.categories.update({
                    where: { id: categoryId },
                    data: {
                        code,
                        name,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await prisma.categories.create({
                    data: {
                        code,
                        name,
                        createdAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                });
            return category;
        });
        res.status(id ? 200 : 201).json(restult);
    } catch (error) {
        logger.error("Error upserting category:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getCategoryById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const category = await prisma.categories.findUnique({
            where: { id: parseInt(id, 10) },
        });
        if (!category) {
            res.status(404).json({ messate: "Category not found!" });
            return;
        }
        res.status(200).json(category);
    } catch (error) {
        logger.error("Error fetching category by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteCategory = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();
    try {
        const category = await prisma.categories.findUnique({ where: { id: parseInt(id, 10) } });
        if (!category) {
            res.status(404).json({ message: "Category not found!" });
            return;
        }
        await prisma.categories.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null
            }
        });
        res.status(200).json(category);
    } catch (error) {
        logger.error("Error deleting category:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};