import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
import { log } from "console";

const prisma = new PrismaClient();

export const getAllCategories = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "id";
        const sortOrder = req.query.sortOrder === "desc" ? "asc" : "desc";
        const skip = (pageNumber - 1) * pageSize;

        // Denamically construct the where ChainCondition
        const whereCondition: any = {
            deletedAt: null // Only include records where deletedAt is null
        };

        if (searchTerm) {
            whereCondition.name = {
                contains: searchTerm,
                mode: "insensitive", // Case-insensitive search
            }
        }

        const total = await prisma.categories.count({
            where: whereCondition
        });

        const categories = await prisma.categories.findMany({
            where: whereCondition, // Filter based on searchTerm if available
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc", // Dynamic sorting
            },
            take: pageSize
        });
        res.status(200).json({ data: categories, total });
    } catch (error) {
        logger.error("Error fetching categories:", error);
        const TypeError = error as Error;
        res.status(500).json({ message: TypeError.message });
    }
};

export const upsertCategory = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { code, name } = req.body;
    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();
    
    try {
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
                    updatedAt: utcNow.toJSDate()
                }
            })
            : await prisma.categories.create({
                data: {
                    code,
                    name,
                    createdAt: utcNow.toJSDate(),
                    updatedAt: utcNow.toJSDate()
                }
            });
        res.status(id ? 200 : 201).json(category);
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
                deletedAt: utcNow.toJSDate()
            }
        });
        res.status(200).json(category);
    } catch (error) {
        logger.error("Error deleting category:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};