import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";

const prisma = new PrismaClient();

export const getAllBranch = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "desc" : "asc";
        const skip = (pageNumber - 1) * pageSize;

        // Dynamically construct the where condition
        const whereCondition: any = {};

        if(searchTerm) {
            whereCondition.name = {
                contains: searchTerm,
                mode: "insensitive", // Case-insensitive search
            }
        }

        // Get total count of role matching the search term
        const total = await prisma.branch.count({
            where: whereCondition, // Filter based on searchTerm if available
        });

        // Fetch pagination roles with sorting and include permission
        const branches = await prisma.branch.findMany({
            where: whereCondition,
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc", // Dynamic sorting
            },
            take: pageSize
        });
        res.status(200).json({ data: branches, total });
    } catch (error) {
        logger.error("Error fetching branches:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getBranchById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const branch = await prisma.branch.findUnique({
            where: { id: parseInt(id, 10) }
        });

        if (branch) {
            res.status(200).json(branch);
        } else {
            res.status(404).json({ message: "Branch not found" });
        }
    } catch (error) {
        logger.error("Error fetching branch by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}

export const upsertBranch = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, address } = req.body;
    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();
    try {
        const branchId = id ? parseInt(id, 10) : undefined;
        if (branchId) {
            const checkBranch = await prisma.branch.findUnique({ where: { id: branchId } });
            if (!checkBranch) {
                res.status(404).json({ message: "Branch not found" });
            }
        }

        const checkExisting = await prisma.branch.findFirst({ 
            where: {
                name,
                id: { not: branchId }
            }
        });
        if (checkExisting) {
            res.status(400).json({ message: "Branch name must be unique" });
            return;
        }
        const branch = id
            ? await prisma.branch.update({
                where: { id: branchId },
                data: {
                    name,
                    address,
                    updatedAt: utcNow.toJSDate()
                }
            })
            : await prisma.branch.create({
                data: {
                    name,
                    address,
                    updatedAt: utcNow.toJSDate()
                }
            });

        res.status(id ? 200 : 201).json(branch);
    } catch (error) {
        logger.error("Error upserting branch:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}