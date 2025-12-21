import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import bcrypt from "bcrypt";
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

export const getAllUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "lastName";
        const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
        const offset = (pageNumber - 1) * pageSize;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        // Base LIKE term
        const likeTerm = `%${searchTerm}%`;
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        // Build dynamic search conditions for creator/updater/branch/role names
        const fullNameConditions = searchWords
            .map((_, idx) => `
                (c."firstName" ILIKE $${idx + 2} OR c."lastName" ILIKE $${idx + 2}
                 OR u."firstName" ILIKE $${idx + 2} OR u."lastName" ILIKE $${idx + 2}
                 OR br."name" ILIKE $${idx + 2}
                 OR r."name" ILIKE $${idx + 2})
            `)
            .join(" AND ");

        // Parameters: $1 = likeTerm, $2..$n = searchWords, $n+1 = limit, $n+2 = offset
        const params = [likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // Branch restriction for USER role
        let branchRestriction = "";
        if (loggedInUser.roleType === "USER" && loggedInUser.branchId) {
            branchRestriction = `AND u."branchId" = ${loggedInUser.branchId}`;
        }

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "User" u
            LEFT JOIN "User" c ON u."createdBy" = c.id
            LEFT JOIN "User" u2 ON u."updatedBy" = u2.id
            LEFT JOIN "Branch" br ON u."branchId" = br.id
            LEFT JOIN "RoleOnUser" ru ON ru."userId" = u.id
            LEFT JOIN "Role" r ON ru."roleId" = r.id
            WHERE u."deletedAt" IS NULL
                ${branchRestriction}
                AND (
                    u."firstName" ILIKE $1
                    OR u."lastName" ILIKE $1
                    OR u."email" ILIKE $1
                    OR u."phoneNumber" ILIKE $1
                    OR TO_CHAR(u."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(u."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(u."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(u."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // ----- 2) DATA FETCH -----
        const users: any = await prisma.$queryRawUnsafe(`
            SELECT u.*,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_agg(
                     json_build_object('id', r.id, 'name', r.name)
                   ) FILTER (WHERE r.id IS NOT NULL) AS roles,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u2.id, 'firstName', u2."firstName", 'lastName', u2."lastName") AS updater
            FROM "User" u
            LEFT JOIN "User" c ON u."createdBy" = c.id
            LEFT JOIN "User" u2 ON u."updatedBy" = u2.id
            LEFT JOIN "Branch" br ON u."branchId" = br.id
            LEFT JOIN "RoleOnUser" ru ON ru."userId" = u.id
            LEFT JOIN "Role" r ON ru."roleId" = r.id
            WHERE u."deletedAt" IS NULL
                ${branchRestriction}
                AND (
                    u."firstName" ILIKE $1
                    OR u."lastName" ILIKE $1
                    OR u."email" ILIKE $1
                    OR u."phoneNumber" ILIKE $1
                    OR TO_CHAR(u."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(u."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(u."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(u."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            GROUP BY u.id, br.id, c.id, u2.id
            ORDER BY u."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: users, total });

    } catch (error) {
        logger.error("Error fetching users:", error);
        const typedError = error as Error;
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
                createdAt: currentDate,
                createdBy: req.user ? req.user.id : null,
                updatedAt: currentDate,
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
            updatedAt: currentDate,
            updatedBy: req.user ? req.user.id : null,
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
        await prisma.user.update({
            where: { id: parseInt(id, 10) },
            data: { 
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null
            }, // Mark the user as deleted by setting the deletedAt timestamp
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
            data: { 
                status: user.status === 1 ? 0 : 1,
                updatedAt: currentDate,
                updatedBy: req.user ? req.user.id : null
            },
        });

        res.status(200).json(updatedUser);
    } catch (error) {
        logger.error("Error updating user status:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};