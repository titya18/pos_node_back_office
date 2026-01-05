import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
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

export const getAllExpenseWithPagination = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "ref";
        const sortOrder = req.query.sortOrder === "asc" ? "desc" : "asc";
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
            branchRestriction = `AND ep."branchId" = ${loggedInUser.branchId}`;
        }

        // 1️ Count total
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Expenses" ep
            LEFT JOIN "Branch" br ON ep."branchId" = br.id
            LEFT JOIN "User" c ON ep."createdBy" = c.id
            LEFT JOIN "User" u ON ep."updatedBy" = u.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    ep."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR ep."description" ILIKE $1
                    OR CAST(ep."amount" AS TEXT) ILIKE $1
                    OR TO_CHAR(ep."expenseDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(ep."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(ep."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(ep."expenseDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(ep."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(ep."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const expenses: any = await prisma.$queryRawUnsafe(`
            SELECT ep.*, 
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "Expenses" ep
            LEFT JOIN "Branch" br ON ep."branchId" = br.id
            LEFT JOIN "User" c ON ep."createdBy" = c.id
            LEFT JOIN "User" u ON ep."updatedBy" = u.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    ep."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR ep."description" ILIKE $1
                    OR CAST(ep."amount" AS TEXT) ILIKE $1
                    OR TO_CHAR(ep."expenseDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(ep."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(ep."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(ep."expenseDate", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(ep."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(ep."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY ep."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: expenses, total });

    } catch (error) {
        logger.error("Error fetching expenses:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getAllExpenses = async (req: Request, res: Response): Promise<void> => {
    try {
        const expenses = await prisma.expenses.findMany(
            {
                where: {
                    branchId: req.user ? req.user.id : 0,
                    deletedAt: null
                }
            }
        );
        res.status(200).json(expenses);
    } catch (error) {
        logger.error("Error fetching expenses:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertExpense = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { branchId, name, amount, description, expenseDate } = req.body;

    try {
        const restult = await prisma.$transaction(async (prisma) => {
            const expenseId = id ? parseInt(id, 10) : undefined;

            if (expenseId) {
                const checkExpense = await prisma.expenses.findUnique({ where: { id: expenseId } });
                if (!checkExpense) {
                    res.status(404).json({ message: "Expense not found!" });
                    return;
                }
            }

            let ref = "EXP-";

            // Generate a new ref only for creation
            if (!id) {
                // Query for the highest ref in the same branch
                const lastExpense = await prisma.expenses.findFirst({
                    where: { branchId: parseInt(branchId, 10) },
                    orderBy: { id: 'desc' }, // Sort by ref in descending order
                });

                // Extract and increment the numeric part of the ref
                if (lastExpense && lastExpense.ref) {
                    const refNumber = parseInt(lastExpense.ref.split('-')[1], 10) || 0;
                    ref += String(refNumber + 1).padStart(5, '0'); // Increment and format with leading zeros
                } else {
                    ref += "00001"; // Start from 00001 if no ref exists for the branch
                }
            }

            const expense = id
                ? await prisma.expenses.update({
                    where: { id: expenseId },
                    data: {
                        branchId: Number(branchId),
                        expenseDate: new Date(dayjs(expenseDate).format("YYYY-MM-DD")),
                        name,
                        amount,
                        description,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await prisma.expenses.create({
                    data: {
                        branchId: Number(branchId),
                        ref,
                        expenseDate: new Date(dayjs(expenseDate).format("YYYY-MM-DD")),
                        name,
                        amount,
                        description,
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null
                    }
                });
            return expense;
        });
        
        res.status(id ? 200 : 201).json(restult);
    } catch (error) {
        logger.error("Error upserting expense:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getExpenseById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const expense = await prisma.expenses.findUnique({
            where: { id: parseInt(id, 10) }
        });
        if (!expense) {
            res.status(404).json({ message: "Expense not found!" });
            return;
        }
        res.status(200).json(expense);
    } catch (error) {
        logger.error("Error fetching expense by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteExpense = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { delReason } = req.body;
    try {
        const expense = await prisma.expenses.findUnique({ where: { id: parseInt(id, 10) } });
        if (!expense) {
            res.status(404).json({ message: "Expense not found!" });
            return;
        }
        await prisma.expenses.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason
            }
        });
        res.status(200).json(expense);
    } catch (error) {
        logger.error("Error deleting expense:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};