import { Request, Response } from "express";
import { DateTime } from "luxon";
import { PrismaClient } from "@prisma/client";
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

export const getAllRoleWithPagination = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
        const offset = (pageNumber - 1) * pageSize;

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

        // Count total
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Role" r
            LEFT JOIN "User" c ON r."createdBy" = c.id
            LEFT JOIN "User" u ON r."updatedBy" = u.id
            WHERE r."name" ILIKE $1
                OR TO_CHAR(r."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(r."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(r."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(r."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // Fetch paginated data
        const roles: any = await prisma.$queryRawUnsafe(`
            SELECT r.*,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                   (
                       SELECT json_agg(json_build_object('id', p.id, 'name', p."name"))
                       FROM "Permission" p
                       JOIN "PermissionOnRole" pr ON pr."roleId" = r.id AND pr."permissionId" = p.id
                   ) AS permissions
            FROM "Role" r
            LEFT JOIN "User" c ON r."createdBy" = c.id
            LEFT JOIN "User" u ON r."updatedBy" = u.id
            WHERE r."name" ILIKE $1
               OR TO_CHAR(r."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(r."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(r."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(r."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            ORDER BY r."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: roles, total });

    } catch (error) {
        logger.error("Error fetching roles:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getAllRoles = async (req: Request, res: Response): Promise<void> => {
    try {
        const roles = await prisma.role.findMany();
        res.status(200).json(roles);
    } catch (error) {
        logger.error("Error fetching all roles:", error);
        const typedError = error as Error;  // Type assertion
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
                    updatedAt: currentDate,
                    updatedBy: req.user ? req.user.id : null
                }
            })
            : await prisma.role.create({
                data: {
                    name,
                    createdAt: currentDate,
                    createdBy: req.user ? req.user.id : null,
                    updatedAt: currentDate,
                    updatedBy: req.user ? req.user.id : null,
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