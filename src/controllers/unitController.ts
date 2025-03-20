import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
import { log } from "console";

const prisma = new PrismaClient();

export const getAllUnits = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "desc" : "asc";
        const skip = (pageNumber - 1) * pageSize;

        const whereCondition: any = {
            deletedAt: null
        };

        if (searchTerm) {
            whereCondition.name = {
                constants: searchTerm,
                mode: "insensitive", // Case-insensitive search
            }
        }

        const total = await prisma.units.count({
            where: whereCondition
        });

        const units = await prisma.units.findMany({
            where: whereCondition,
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc",
            },
            take: pageSize
        });
        res.status(200).json({ data: units, total });
    } catch (error) {
        logger.error("Error fetching units:", error);
        const typedError = error as Error; 
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertUnit = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name } = req.body;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();

    try {
        const unitId = id ? parseInt(id, 10) : undefined;
        if (unitId) {
            const checkUnit = await prisma.units.findUnique({ where: { id: unitId } });
            if (!checkUnit) {
                res.status(404).json({ message: "Unit not found!" });
                return;
            }
        }

        const checkExisting = await prisma.units.findFirst({
            where: {
                name,
                id: { not: unitId }
            }
        });
        if (checkExisting) {
            res.status(400).json({ message: "Unit's name must be unique" });
            return;
        }

        const unit = id
            ? await prisma.units.update({
                where: { id: unitId },
                data: {
                    name,
                    updatedAt: utcNow.toJSDate()
                }
            })
            : await prisma.units.create({
                data: {
                    name,
                    createdAt: utcNow.toJSDate(),
                    updatedAt: utcNow.toJSDate()
                }
            });
        res.status(id ? 200 : 201).json(unit);
    } catch (error) {
        logger.error("Error upserting unit:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getUnitById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const unit = await prisma.units.findUnique({
            where: { id: parseInt(id, 10) }
        });
        if (!unit) {
            res.status(404).json({ message: "Unit not found!" });
            return;
        }
        res.status(200).json(unit);
    } catch (error) {
        logger.error("Error fetching unit by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteUnit = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    try {
        const unit = await prisma.units.findUnique({
            where: { id: parseInt(id, 10) }
        });
        if (!unit) {
            res.status(404).json({ message: "Unit not found!" });
            return;
        }
        await prisma.units.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: utcNow.toJSDate()
            }
        });
        res.status(200).json(unit);
    } catch (error) {
        logger.error("Error deleting unit:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}