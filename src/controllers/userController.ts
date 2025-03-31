import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import bcrypt from "bcrypt";
import logger from "../utils/logger";
import { log } from "console";

const prisma = new PrismaClient();

export const getAllUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "lastName";
        const sortOrder = req.query.sortOrder === "desc" ? "desc" : "asc";
        const skip = (pageNumber - 1) * pageSize;

        const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
        // Verify that loggedInUser is defined
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        // Dynamically construct the where condition
        const whereCondition: any = {};

        // Apply branchId filter only for USER roleType
        if (loggedInUser.roleType === "USER" && loggedInUser.branchId) {
            whereCondition.branchId = loggedInUser.branchId;
        }

        if (searchTerm) {
            whereCondition.name = {
                contains: searchTerm,
                mode: "insensitive", // Case-insensitive search
            }
        }

        // Get total count of user matching the search term
        const total = await prisma.user.count({
            where: whereCondition
        });

        // Fetch pagination user with sorting and include permission
        const users = await prisma.user.findMany({
            where: whereCondition, // Filter based on searchTerm if available
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc", // Dynamic sorting
            },
            take: pageSize,
            include: {
                branch: {
                    select: {
                        id: true,
                        name: true,
                    }
                },
                roles: {
                    select: {
                        role: {
                            select: {
                                id: true,
                                name: true,  // Select only the fields you need
                            },
                        },
                    },
                },
            },
        });
        
        // Step 2: Transform the users' data to fit the UserData and RoleType structure
        const formattedUsers = users.map((user: any) => ({
            ...user,  // Spread the rest of the user data (id, email, firstName, etc.)
            roles: user.roles.map((roleOnUser: any) => ({
                id: roleOnUser.role.id,  // Extract id from nested role object
                name: roleOnUser.role.name,  // Extract name from nested role object
            })),
        }));

        res.status(200).json({data: formattedUsers, total});
    } catch (error) {
        logger.error("Error fetching users:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

export const getUserById = async (req: Request, res: Response): Promise<void> => {
    try {
        const user = await prisma.user.findUnique({ 
            where: { id: parseInt(req.params.id, 10) }, 
            include: { roles: true }
        });
        if (!user) {
            res.status(400).json({ message: "User not found" });
        }
        res.status(200).json(user);
    } catch (error) {
        logger.error("Error fetching user by ID:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

export const createUser = async (req: Request, res: Response): Promise<void> => {
    const { branchId, firstName, lastName, phoneNumber, email, roleType, password, roleIds } = req.body;

    // Convert branchId to an integer if it's provided
    const parsedBranchId = branchId ? parseInt(branchId, 10) : null;

    // Convert local time to UTC
    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();

    try {
        // Check if the user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            res.status(400).json({ message: "User with this email already exists" });
            return;
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        const userType = roleType && roleType.trim() !== "" ? roleType : "USER";

        // Create the new user and connect roles
        const newUser = await prisma.user.create({
            data: {
                branchId: parsedBranchId,
                firstName,
                lastName,
                phoneNumber,
                email,
                password: hashedPassword,
                roleType: userType,
                status: 1,
                roles: {
                    create: (roleIds as number[]).map((roleIds: number) => ({
                        role: { connect: { id: roleIds } },
                    })),

                    // connect: roleIds.map((roleId: number) => ({
                    //     roleId: roleId,
                    // })),
                },
                createdAt: utcNow.toJSDate(),
                updatedAt: utcNow.toJSDate(),
            },
            include: {
                roles: {
                    include: {
                        role: true,
                    },
                },
            },
        });

        res.status(201).json(newUser);
    } catch (error) {
        logger.error("Error creating user:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

export const updateUser = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params; // Get user ID from request params
    const { branchId, firstName, lastName, phoneNumber, email, roleType, password, roleIds } = req.body;

    // Convert branchId to an integer if it's provided
    const parsedBranchId = branchId ? parseInt(branchId, 10) : null;

    // Convert local time to UTC
    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();

    try {
        // Check if the user exists
        const existingUser = await prisma.user.findUnique({
            where: { id: parseInt(id, 10) },
        });

        if (!existingUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }

        // Check if the email is being changed and if the new email is already taken
        if (email && email !== existingUser.email) {
            const emailTaken = await prisma.user.findUnique({
                where: { email },
            });

            if (emailTaken) {
                res.status(400).json({ message: "Email is already taken" });
                return;
            }
        }

        // Create update data object
        const updateData: any = {
            branchId: parsedBranchId,
            firstName,
            lastName,
            phoneNumber,
            roleType,
            email,
            updatedAt: utcNow.toJSDate(),
        };

        if (password) {
            // Hash the new password if provided
            updateData.password = await bcrypt.hash(password, 10);
        }

        // Update user and manage role connections
        const updatedUser = await prisma.user.update({
            where: { id: parseInt(id, 10) },
            data: {
                ...updateData,
                roles: {
                    deleteMany: {}, // Clear existing role-permissions
                    create: (roleIds as number[]).map((roleIds: number) => ({
                        role: { connect: { id: roleIds } },
                    })),
                },
            },
            include: {
                roles: {
                    include: {
                        role: true,
                    },
                },
            },
        });

        res.status(200).json(updatedUser);
    } catch (error) {
        logger.error("Error updating user:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteUser = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params; // Get user ID from request params

    try {
        // Check if the user exists
        const existingUser = await prisma.user.findUnique({
            where: { id: parseInt(id, 10) },
        });

        if (!existingUser) {
            res.status(404).json({ message: "User not found" });
            return;
        }

        // Delete the user
        await prisma.user.delete({
            where: { id: parseInt(id, 10) },
        });

        res.status(200).json({ message: "User deleted successfully" });
    } catch (error) {
        logger.error("Error deleting user:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};

export const statusUser = async (req: Request, res: Response): Promise<void> => {
    const userId = parseInt(req.params.id, 10); // Parse user ID from request params

    try {
        // Find the user by ID
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            res.status(404).json({ message: "User not found" });
            return;
        }

        // Toggle the user's status
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { status: user.status === 1 ? 0 : 1 },
        });

        res.status(200).json(updatedUser);
    } catch (error) {
        logger.error("Error updating user status:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};