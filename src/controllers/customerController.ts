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

export const getAllCustomersWithPagination = async (req: Request, res: Response): Promise<void> => {
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
            FROM "Customer" cs
            LEFT JOIN "User" c ON cs."createdBy" = c.id
            LEFT JOIN "User" u ON cs."updatedBy" = u.id
            WHERE
                cs."name" ILIKE $1
                OR cs."phone" ILIKE $1
                OR cs."email" ILIKE $1
                OR cs."address" ILIKE $1
                OR TO_CHAR(cs."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cs."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cs."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cs."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const customers: any = await prisma.$queryRawUnsafe(`
            SELECT cs.*, 
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "Customer" cs
            LEFT JOIN "User" c ON cs."createdBy" = c.id
            LEFT JOIN "User" u ON cs."updatedBy" = u.id
            WHERE
                cs."name" ILIKE $1
                OR cs."phone" ILIKE $1
                OR cs."email" ILIKE $1
                OR cs."address" ILIKE $1
                OR TO_CHAR(cs."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cs."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cs."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(cs."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            ORDER BY cs."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: customers, total });
    } catch (error) {
        logger.error("Error fetching customers:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getAllCustomers = async (req: Request, res: Response): Promise<void> => {
    try {
        const customers = await prisma.customer.findMany();

        res.status(200).json(customers);
    } catch (error) {
        logger.error("Error fetching customers:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertCustomer = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, phone, email, address } = req.body;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();

    try {
        const result = await prisma.$transaction(async (prisma) => {
            const customerId = id ? parseInt(id, 10) : undefined;
            // console.log("Upsert Customer - Received Data:", { id, name, phone, email, address });

            const checkExisting = await prisma.customer.findFirst({
                where: {
                    phone,
                    email,
                    id: { not: customerId }
                }
            });

            if (checkExisting) {
                res.status(400).json({ message: "Customer with the same phone or email already exists!" });
                return;
            }

            if (customerId) {
                const checkCustomer = await prisma.customer.findUnique({ where: { id: customerId } });
                if (!checkCustomer) {
                    res.status(404).json({ message: "Customer not found!" });
                    return;
                }
            }

            const customer = id
                ? await prisma.customer.update({
                    where: { id: customerId },
                    data: {
                        name,
                        phone,
                        email,
                        address,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await prisma.customer.create({
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
                
            return customer;
        });

        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error upserting customer:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getCustomerById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const customer = await prisma.customer.findUnique({
            where: { id: parseInt(id, 10) }
        });
        if (!customer) {
            res.status(404).json({ message: "Customer not found!" });
            return;
        }
        res.status(200).json(customer);
    } catch (error) {
        logger.error("Error fetching customer by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};