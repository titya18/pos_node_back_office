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

export const getAllPaymentMethodsWithPagination = async (req: Request, res: Response): Promise<void> => {
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
            FROM "PaymentMethods" b
            LEFT JOIN "User" c ON b."createdBy" = c.id
            LEFT JOIN "User" u ON b."updatedBy" = u.id
            WHERE b."deletedAt" IS NULL
            AND (
                b."name" ILIKE $1
                OR TO_CHAR(b."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const paymentMethods: any = await prisma.$queryRawUnsafe(`
            SELECT b.*, 
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "PaymentMethods" b
            LEFT JOIN "User" c ON b."createdBy" = c.id
            LEFT JOIN "User" u ON b."updatedBy" = u.id
            WHERE b."deletedAt" IS NULL
            AND (
                b."name" ILIKE $1
                OR TO_CHAR(b."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
            ORDER BY b."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: paymentMethods, total });

    } catch (error) {
        logger.error("Error fetching payment methods:", error);
        res.status(500).json({ message: (error as Error).message });
    }
};

export const getAllPaymentMethods = async (req: Request, res: Response): Promise<void> => {
    try {
        const paymentMethods = await prisma.paymentMethods.findMany();
        res.status(200).json(paymentMethods);
    } catch (error) {
        logger.error("Error fetching payment methods:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}

export const upsertPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name } = req.body;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();

    try {
        const result = await prisma.$transaction(async (prisma) => {
            const paymentId = id ? (Array.isArray(id) ? id[0] : id) : 0;
            if (paymentId) {
                const checkPayment = await prisma.paymentMethods.findUnique({ where: { id: Number(paymentId) } });
                if (!checkPayment) {
                    res.status(404).json({ message: "Payment method not found!"});
                    return;
                }
            }

            const checkExisting = await prisma.paymentMethods.findFirst({
                where: {
                    name,
                    id: { not: Number(paymentId) }
                }
            });
            if (checkExisting) {
                res.status(400).json({ message: "Payment method name must be unique"});
                return;
            }

            const paymentmethod = id
                ? await prisma.paymentMethods.update({
                    where: { id: Number(paymentId) },
                    data: {
                        name,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await prisma.paymentMethods.create({
                    data: {
                        name,
                        createdAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                });
            return paymentmethod;
        });
        
        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error upserting payment method:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getPaymentMethodById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const paymentId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    try {
        const paymentMethod = await prisma.paymentMethods.findUnique({ where: { id: Number(paymentId) } });
        if (!paymentMethod) {
            res.status(404).json({ message: "Payment method not found!" });
            return;
        }
        res.status(200).json(paymentMethod);
    } catch (error) {
        logger.error("Error fetching payment method by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deletePaymentMethod = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const paymentId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    try {
        const paymentMethod = await prisma.paymentMethods.findUnique({ where : { id: Number(paymentId) } });
        if (!paymentMethod) {
            res.status(404).json({ message: "Payment method not found!" });
            return;
        }
        await prisma.paymentMethods.update({
            where: { id: Number(paymentId) },
            data: {
                deletedAt: currentDate,
                updatedAt: currentDate,
                updatedBy: req.user ? req.user.id : null
            }
        });
        res.status(200).json(paymentMethod);
    } catch (error) {
        logger.error("Error deleting payment method:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}