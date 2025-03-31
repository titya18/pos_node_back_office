import { Request, Response } from "express";
import { DateTime } from "luxon";
import { PrismaClient } from "@prisma/client";
import logger from "../utils/logger";
import { log } from "console";

const prisma = new PrismaClient();

export const getAllRole = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "desc" : "asc";
        const skip = (pageNumber - 1) * pageSize;

        // Dynamically construct the where condition
        const whereCondition: any = {};

        if (searchTerm) {
            whereCondition.name = {
                contains: searchTerm,
                mode: "insensitive", // Case-insensitive search
            }
        }

        // Get total count of role matching the search term
        const total = await prisma.role.count({
            where: whereCondition
        });

        // Fetch pagination roles with sorting and include permission
        const roles = await prisma.role.findMany({
            where: whereCondition, // Filter based on searchTerm if available
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc", // Dynamic sorting
            },
            take: pageSize,
            include: { permissions: true }
        });
        res.status(200).json({data: roles, total});
    } catch (error) {
        logger.error("Error fetching roles:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertRole = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, permissions } = req.body;

    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();

    try {
        const roleId = id ? parseInt(id, 10) : undefined;

        if (roleId) {
            const checkRole = await prisma.role.findUnique({ where: { id: roleId } });
            if (!checkRole) {
                res.status(404).json({ message: "Role not found!" });
                return;
            }
        }

        const checkExisting = await prisma.role.findFirst({
            where: {
                name,
                id: { not: roleId }
            }
        });
        if (checkExisting) {
            res.status(400).json({ message: "Role's name must be unique" });
            return;
        }

        const role = id
            ? await prisma.role.update({
                where: { id: roleId },
                data: {
                    name,
                    permissions: {
                        deleteMany: {}, // Clear existing role-permissions
                        create: (permissions as number[]).map((permissionId: number) => ({
                            permission: { connect: { id: permissionId } },
                        })),
                    },
                    updatedAt: utcNow.toJSDate()
                }
            })
            : await prisma.role.create({
                data: {
                    name,
                    createdAt: utcNow.toJSDate(),
                    updatedAt: utcNow.toJSDate(),
                    permissions: {
                        create: (permissions as number[]).map((permissionId: number) => ({
                            permission: { connect: { id: permissionId } },
                        })),
                    },
                }
            });
            
        res.status(id ? 200 : 201).json(role);
    } catch (error) {
        logger.error("Error upserting role:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getRoleById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const role = await prisma.role.findUnique({ 
            where: { id: parseInt(id, 10) },
            include: { permissions: true }
        });
        if (!role) {
            res.status(404).json({ message: "Role not found!" });
            return;
        }
        res.status(200).json(role)
    } catch (error) {
        logger.error("Error fetching role:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteRole = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const role = await prisma.role.findUnique({ where: { id: parseInt(id, 10) } });
        if (!role) {
            res.status(404).json({ message: "Role not found!" });
            return;
        }
        await prisma.role.delete({
            where: { id: parseInt(id, 10) }
        });
        res.status(200).json({ message: "Role deleted successfully" });
    } catch (error) {
        logger.error("Error deleting role:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};