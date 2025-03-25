import { Request, Response } from 'express';
import { DateTime } from "luxon";
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { log } from 'console';

const prisma = new PrismaClient();

export const upsertModule = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params; // Extract id from URL parameters
    const { name, permissions } = req.body;
    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();

    try {
        // Parse id to integer if present
        const moduleId = id ? parseInt(id, 10) : undefined;

        // Step 1: Fetch the current module if updating
        let currentModulePermissions: string[] = [];
        if (moduleId) {
            const currentModule = await prisma.module.findUnique({
                where: { id: moduleId },
                include: { permissions: true } // Include associated permissions
            });

            if (!currentModule) {
                res.status(404).json({ message: 'Module not found' });
                return;
            }

            // Extract existing permissions for this module
            currentModulePermissions = currentModule.permissions.map((p: any) => p.name);
        }

        // Step 2: Check if the module name is unique (excluding the current module if updating)
        const existingModule = await prisma.module.findFirst({
            where: {
                name,
                id: { not: moduleId } // Exclude the current module from the unique name check
            }
        });

        if (existingModule) {
            res.status(400).json({ message: 'Module name must be unique' });
            return;
        }

        // Step 3: Handle permissions mapping
        const permissionsData = permissions ? permissions.map((perm: { name: string }) => ({ name: perm.name })) : [];

        // Step 4: Check for unique permission names excluding the current module’s permissions
        const permissionChecks = permissionsData.map(async (perm: { name: string }) => {
            const existingPermission = await prisma.permission.findFirst({
                where: {
                    name: perm.name,
                    AND: { NOT: { name: { in: currentModulePermissions } } } // Exclude permissions of the current module
                }
            });

            return {
                name: perm.name,
                exists: !!existingPermission // true if exists, false otherwise
            };
        });

        const permissionResults = await Promise.all(permissionChecks);

        // Extract names of existing permissions
        const existingPermissionNames = permissionResults
            .filter(result => result.exists)
            .map(result => result.name);

        // If there are existing permissions, return them in the response
        if (existingPermissionNames.length > 0) {
            res.status(400).json({ 
                message: `Permissions ${existingPermissionNames.join(', ')} already exist`,
                existingPermissions: existingPermissionNames
            });
            return;
        }

        // Step 3: Create or Update the module based on whether an id exists
        let module;
        if (moduleId) {
            // Update existing module
            module = await prisma.module.update({
                where: { id: moduleId },
                data: {
                    name,
                    updatedAt: utcNow.toJSDate(),
                    permissions: {
                        deleteMany: {}, // Remove existing permissions
                        create: permissionsData // Add new permissions
                    }
                }
            });
        } else {
            // Create a new module
            module = await prisma.module.create({
                data: {
                    name,
                    createdAt: utcNow.toJSDate(),
                    updatedAt: utcNow.toJSDate(),
                    permissions: {
                        create: permissionsData // Create new permissions
                    }
                }
            });
        }

        res.status(moduleId ? 200 : 201).json(module);
    } catch (error) {
        logger.error("Error upserting module:", error);
        console.error("Error upserting module:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Get All Modules
export const getModules = async (req: Request, res: Response): Promise<void> => {
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
            };
        }

        // Get total count of module matching the search term
        const total = await prisma.module.count({
            where: whereCondition,
        });

        // Fetch pagination modules with sorting and include permission
        const modules = await prisma.module.findMany({
            where: whereCondition, // Filter based on searchTerm if available
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc", // Dynamic sorting
            },
            take: pageSize,
            include: { permissions: true }
        });
        res.status(200).json({data: modules, total});
    } catch (error) {
        logger.error("Error fetching modules:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

// Get Module by ID
export const getModuleById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const module = await prisma.module.findUnique({
            where: { id: parseInt(id, 10) },
            include: { permissions: true }
        });

        if (module) {
            res.status(200).json(module);
        } else {
            res.status(404).json({ message: 'Module not found' });
        }
    } catch (error) {
        logger.error("Error fetching module by ID:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

// Delete a Module
export const deleteModule = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        await prisma.module.delete({
            where: { id: parseInt(id, 10) }
        });
        res.status(204).end(); // No content
    } catch (error) {
        logger.error("Error deleting module:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};