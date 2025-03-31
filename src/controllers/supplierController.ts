import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
import { log } from "console";

const prisma = new PrismaClient();

export const getAllSuppliers = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "desc" : "asc";
        const skip = (pageNumber - 1) * pageSize;

        const whereCondition: any = {
            deletedAt: null // Only include records where deletedAt is null
        }

        if (searchTerm) {
            whereCondition.name = {
                contains: searchTerm,
                mode: "insensitive", // Case-insensitive search
            }
        }

        const total = await prisma.suppliers.count({
            where: whereCondition
        });

        const suppliers = await prisma.suppliers.findMany({
            where: whereCondition,
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc"
            },
            take: pageSize
        });
        res.status(200).json({ data: suppliers, total });
    } catch (error) {
        logger.error("Error fetching suppliers:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertSupplier = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, phone, email, address } = req.body;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();

    try {
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
                    updatedAt: utcNow.toJSDate()
                }
            })
            : await prisma.suppliers.create({
                data: {
                    name,
                    phone,
                    email,
                    address,
                    createdAt: utcNow.toJSDate(),
                    updatedAt: utcNow.toJSDate()
                }
            });
        res.status(id ? 200 : 201).json(supplier);
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
                deletedAt: utcNow.toJSDate()
            }
        });
        res.status(200).json(supplier);
    } catch (error) {
        logger.error("Error deleting supplier:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};