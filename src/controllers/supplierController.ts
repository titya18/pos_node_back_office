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

export const getAllSuppliersWithPagination = async (req: Request, res: Response): Promise<void> => {
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
            FROM "Suppliers" s
            LEFT JOIN "User" c ON s."createdBy" = c.id
            LEFT JOIN "User" u ON s."updatedBy" = u.id
            WHERE
                s."name" ILIKE $1
                OR s."phone" ILIKE $1
                OR s."email" ILIKE $1
                OR s."address" ILIKE $1
                OR TO_CHAR(s."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const suppliers: any = await prisma.$queryRawUnsafe(`
            SELECT s.*, 
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "Suppliers" s
            LEFT JOIN "User" c ON s."createdBy" = c.id
            LEFT JOIN "User" u ON s."updatedBy" = u.id
            WHERE
                s."name" ILIKE $1
                OR s."phone" ILIKE $1
                OR s."email" ILIKE $1
                OR s."address" ILIKE $1
                OR TO_CHAR(s."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            ORDER BY s."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: suppliers, total });

    } catch (error) {
        logger.error("Error fetching suppliers:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getAllSuppliers = async (req: Request, res: Response): Promise<void> => {
    try {
        const suppliers = await prisma.suppliers.findMany({
            where: {
                deletedAt: null
            }
        });
        res.status(200).json(suppliers);
    } catch (error) {
        logger.error("Error fetching suppliers:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertSupplier = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, phone, email, address } = req.body;

    try {
        const result = await prisma.$transaction(async (prisma) => {
            const supplierId = id ? parseInt(id, 10) : undefined;
            if (supplierId) {
                const checkSupplier = await prisma.suppliers.findUnique({ where: { id: supplierId } });
                if (!checkSupplier) {
                    res.status(404).json({ message: "Supplier not found!" });
                    return;
                }
            }

            const checkExisting = await prisma.suppliers.findFirst({
                where: {
                    phone,
                    id: { not: supplierId }
                }
            });
            if (checkExisting) {
                res.status(400).json({ message: "Supplier's phone must be unique"});
                return;
            }

            const supplier = id
                ? await prisma.suppliers.update({
                    where: { id: supplierId },
                    data: {
                        name,
                        phone,
                        email,
                        address,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await prisma.suppliers.create({
                    data: {
                        name,
                        phone,
                        email,
                        address,
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null
                    }
                });

            return supplier;
        });
        
        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error upserting supplier:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getSupplierById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const supplier = await prisma.suppliers.findUnique({ where: { id: parseInt(id, 10) } });
        if (!supplier) {
            res.status(404).json({ message: "Supplier not found!" });
            return;
        }
        res.status(200).json(supplier);
    } catch (error) {
        logger.error("Error fetching supplier by ID:", error);
        const typedError = error as Error;
        res. status(500).json({ message: typedError.message });
    }
};

export const deleteSupplier = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    try {
        const supplier = await prisma.suppliers.findUnique({ where: { id: parseInt(id, 10) } });
        if (!supplier) {
            res.status(404).json({ message: "Supplier not found!" });
            return;
        }
        await prisma.suppliers.update({
            where: { id: parseInt(id, 10 )},
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null
            }
        });
        res.status(200).json(supplier);
    } catch (error) {
        logger.error("Error deleting supplier:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};