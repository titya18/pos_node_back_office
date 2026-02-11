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

export const getAllServicesWithPagination = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "name")!;
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "desc" : "asc";
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
            FROM "Services" s
            LEFT JOIN "User" c ON s."createdBy" = c.id
            LEFT JOIN "User" u ON s."updatedBy" = u.id
            WHERE
                s."name" ILIKE $1
                OR s."description" ILIKE $1
                OR CAST(s."price" AS TEXT) ILIKE $1
                OR TO_CHAR(s."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const services: any = await prisma.$queryRawUnsafe(`
            SELECT s.*, 
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "Services" s
            LEFT JOIN "User" c ON s."createdBy" = c.id
            LEFT JOIN "User" u ON s."updatedBy" = u.id
            WHERE
                s."name" ILIKE $1
                OR s."description" ILIKE $1
                OR CAST(s."price" AS TEXT) ILIKE $1
                OR TO_CHAR(s."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(s."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            ORDER BY s."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: services, total });

    } catch (error) {
        logger.error("Error fetching services:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getAllServices = async (req: Request, res: Response): Promise<void> => {
    try {
        const services = await prisma.services.findMany(
            {
                where: {
                    deletedAt: null
                }
            }
        );
        res.status(200).json(services);
    } catch (error) {
        logger.error("Error fetching services:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertService = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { serviceCode, name, description, price } = req.body;

    try {
        const restult = await prisma.$transaction(async (prisma) => {
            const serviceId = id ? parseInt(id, 10) : undefined;
            // console.log("Upsert Service - Received Data:", { id, name, description, price, imagePath });

            const checkExisting = await prisma.services.findFirst({
                where: {
                    serviceCode,
                    id: { not: serviceId }
                }
            });

            if (checkExisting) {
                res.status(400).json({ message: "Service code already exists!" });
                return;
            }

            if (serviceId) {
                const checkService = await prisma.services.findUnique({ where: { id: serviceId } });
                if (!checkService) {
                    res.status(404).json({ message: "Service not found!" });
                    return;
                }
            }

            const service = id
                ? await prisma.services.update({
                    where: { id: serviceId },
                    data: {
                        serviceCode,
                        name,
                        description,
                        price,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await prisma.services.create({
                    data: {
                        serviceCode,
                        name,
                        description,
                        price,
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null
                    }
                });
            return service;
        });
        
        res.status(id ? 200 : 201).json(restult);
    } catch (error) {
        logger.error("Error upserting service:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getServiceById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const service = await prisma.services.findUnique({
            where: { id: parseInt(id, 10) }
        });
        if (!service) {
            res.status(404).json({ message: "Service not found!" });
            return;
        }
        res.status(200).json(service);
    } catch (error) {
        logger.error("Error fetching service by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteService = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const service = await prisma.services.findUnique({ where: { id: parseInt(id, 10) } });
        if (!service) {
            res.status(404).json({ message: "Service not found!" });
            return;
        }
        await prisma.services.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null
            }
        });
        res.status(200).json(service);
    } catch (error) {
        logger.error("Error deleting service:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};