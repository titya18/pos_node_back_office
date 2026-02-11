import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
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

export const getAllExchangesWithPagination = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortFieldRaw = getQueryString(req.query.sortField, "id")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "asc" ? "asc" : "desc";

        const allowedSortFields = ["id", "amount", "createdAt", "updatedAt"];
        const sortField = allowedSortFields.includes(sortFieldRaw)
            ? sortFieldRaw
            : "id";
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
            FROM "ExchangeRates" ecr
            LEFT JOIN "User" c ON ecr."createdBy" = c.id
            LEFT JOIN "User" u ON ecr."updatedBy" = u.id
            WHERE
                ecr."amount"::text ILIKE $1
                OR TO_CHAR(ecr."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(ecr."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(ecr."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(ecr."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const exchanges: any = await prisma.$queryRawUnsafe(`
            SELECT ecr.*, 
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "ExchangeRates" ecr
            LEFT JOIN "User" c ON ecr."createdBy" = c.id
            LEFT JOIN "User" u ON ecr."updatedBy" = u.id
            WHERE
                ecr."amount"::text ILIKE $1
                OR TO_CHAR(ecr."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(ecr."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(ecr."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(ecr."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            ORDER BY ecr."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: exchanges, total });

    } catch (error) {
        logger.error("Error fetching exchanges:", error);
        res.status(500).json({ message: (error as Error).message });
    }
};

export const getLastExchangeRate = async (req: Request, res: Response): Promise<void> => {
    try {
        const lastExchange = await prisma.exchangeRates.findFirst({
            orderBy: {
                id: "desc",
            },
        });
        res.status(200).json(lastExchange);
    } catch (error) {
        logger.error("Error fetching last exchange rate:", error);
        res.status(500).json({ message: (error as Error).message });
    }
};

export const upsertExchangeRate = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { amount } = req.body;
    try {
        const result = await prisma.$transaction(async (tx) => {
            const exchangeId = id ? (Array.isArray(id) ? id[0] : id) : 0;
            if (exchangeId) {
                const checkBranch = await tx.exchangeRates.findUnique({ where: { id: Number(exchangeId) } });
                if (!checkBranch) {
                    res.status(404).json({ message: "Exchange rate not found" });
                }
            }

            const exchange = id
                ? await tx.exchangeRates.update({
                    where: { id: Number(exchangeId) },
                    data: {
                        amount: Number(amount),
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await tx.exchangeRates.create({
                    data: {
                        amount: Number(amount),
                        createdAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                });
            return exchange;
        });

        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error upserting exchange rate:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}