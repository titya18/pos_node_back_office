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

export const getAllIncomeWithPagination = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "ref")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "asc" ? "asc" : "desc";
        const offset = (pageNumber - 1) * pageSize;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        // Base LIKE term for simple fields
        const likeTerm = `%${searchTerm}%`;

        // Split search term into words for full name search
        const searchWords = searchTerm.split(/\s+/).filter(Boolean); // ["Lorn", "Titya"]

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
            branchRestriction = `AND inc."branchId" = ${loggedInUser.branchId}`;
        }

        // 1️ Count total
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Incomes" inc
            LEFT JOIN "Branch" br ON inc."branchId" = br.id
            LEFT JOIN "User" c ON inc."createdBy" = c.id
            LEFT JOIN "User" u ON inc."updatedBy" = u.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    inc."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR inc."description" ILIKE $1
                    OR CAST(inc."amount" AS TEXT) ILIKE $1
                    OR TO_CHAR(inc."incomeDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(inc."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(inc."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(inc."incomeDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(inc."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(inc."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));


        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const incomes: any = await prisma.$queryRawUnsafe(`
            SELECT inc.*, 
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "Incomes" inc
            LEFT JOIN "Branch" br ON inc."branchId" = br.id
            LEFT JOIN "User" c ON inc."createdBy" = c.id
            LEFT JOIN "User" u ON inc."updatedBy" = u.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    inc."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR inc."description" ILIKE $1
                    OR CAST(inc."amount" AS TEXT) ILIKE $1
                    OR TO_CHAR(inc."incomeDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(inc."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(inc."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(inc."incomeDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(inc."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(inc."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY inc."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: incomes, total });

    } catch (error) {
        logger.error("Error fetching incomes:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getAllIncomes = async (req: Request, res: Response): Promise<void> => {
    try {
        const incomes = await prisma.incomes.findMany(
            {
                where: {
                    branchId: req.user ? req.user.id : 0,
                    deletedAt: null
                }
            }
        );
        res.status(200).json(incomes);
    } catch (error) {
        logger.error("Error fetching incomes:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertIncome = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { branchId, name, amount, description, incomeDate } = req.body;

    try {
        const restult = await prisma.$transaction(async (prisma) => {
            const incomeId = id ? (Array.isArray(id) ? id[0] : id) : 0;

            if (incomeId) {
                const checkIncome = await prisma.incomes.findUnique({ where: { id: Number(incomeId) } });
                if (!checkIncome) {
                    res.status(404).json({ message: "Income not found!" });
                    return;
                }
            }

            let ref = "INC-";

            // Generate a new ref only for creation
            if (!id) {
                // Query for the highest ref in the same branch
                const lastIncome = await prisma.incomes.findFirst({
                    where: { branchId: parseInt(branchId, 10) },
                    orderBy: { id: 'desc' }, // Sort by ref in descending order
                });

                // Extract and increment the numeric part of the ref
                if (lastIncome && lastIncome.ref) {
                    const refNumber = parseInt(lastIncome.ref.split('-')[1], 10) || 0;
                    ref += String(refNumber + 1).padStart(5, '0'); // Increment and format with leading zeros
                } else {
                    ref += "00001"; // Start from 00001 if no ref exists for the branch
                }
            }

            const income = id
                ? await prisma.incomes.update({
                    where: { id: Number(incomeId) },
                    data: {
                        branchId: Number(branchId),
                        incomeDate: new Date(dayjs(incomeDate).format("YYYY-MM-DD")),
                        name,
                        amount,
                        description,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await prisma.incomes.create({
                    data: {
                        branchId: Number(branchId),
                        ref,
                        incomeDate: new Date(dayjs(incomeDate).format("YYYY-MM-DD")),
                        name,
                        amount,
                        description,
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null
                    }
                });
            return income;
        });
        
        res.status(id ? 200 : 201).json(restult);
    } catch (error) {
        logger.error("Error upserting income:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getIncomeById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const incomeId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    try {
        const income = await prisma.incomes.findUnique({
            where: { id: Number(incomeId) }
        });
        if (!income) {
            res.status(404).json({ message: "Income not found!" });
            return;
        }
        res.status(200).json(income);
    } catch (error) {
        logger.error("Error fetching income by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteIncome = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const incomeId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    const { delReason } = req.body;
    try {
        const income = await prisma.incomes.findUnique({ where: { id: Number(incomeId) } });
        if (!income) {
            res.status(404).json({ message: "Income not found!" });
            return;
        }
        await prisma.incomes.update({
            where: { id: Number(incomeId) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason
            }
        });
        res.status(200).json(income);
    } catch (error) {
        logger.error("Error deleting income:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};