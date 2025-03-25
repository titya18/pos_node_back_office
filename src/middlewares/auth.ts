import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: number;
                branchId: number | null;
                email: string;
                firstName: string;
                lastName: string;
                roleType: string;
                roles: Array<{
                    id: number;
                    name: string;
                    permissions: string[];
                }>;
            };
        }
    }
}

// Define interfaces for RoleOnUser and PermissionOnRole
interface RoleOnUser {
    role: {
        id: number;
        name: string;
        permissions: {
            permission: {
                name: string;
            }
        }[];
    }
}

interface PermissionOnRole {
    name: string;
}

const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies["auth_token"];

    if (!token) {
        res.status(401).json({ message: "Unauthorized: No token provided" });
        return;
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY as string) as JwtPayload;

        // console.log("Decoded token:", decoded); // Add logging here

        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            include: {
                roles: {
                    include: {
                        role: {
                            include: {
                                permissions: {
                                    include: {
                                        permission: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (user) {
            // Map the roles and permissions to the format expected by the interface
            const rolesWithPermissions = user.roles.map((roleOnUser: RoleOnUser) => ({
                id: roleOnUser.role.id,
                name: roleOnUser.role.name,
                permissions: roleOnUser.role.permissions.map((permissionOnRole: { permission: PermissionOnRole }) =>
                    permissionOnRole.permission.name // Correct mapping: extract name directly
                )
                // permissions: roleOnUser.role.permissions.map(
                //     permissionOnRole => permissionOnRole.permission.name
                // ),
            }));

            // Assign to req.user with correct 'roles' field
            req.user = {
                id: user.id,
                branchId: user.branchId,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                roleType: user.roleType,
                roles: rolesWithPermissions
            };
            // console.log("User object attached to request:", req.user); // Log the user
            next();
        } else {
            res.status(404).json({ message: "User not found" });
            return;
        }
    } catch (error) {
        console.log("Token verification error:", error); // Log the error
        res.status(401).json({ message: "Unauthorized: Invalid token" });
        return;
    }
};

const authorize = (requiredPermissions: string[]) => (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user || !user.roles) {
        return res.status(403).json({ message: 'Forbidden: No user or roles found' });
    }

    // Flatten the permissions array from roles
    const userPermissions = user.roles.flatMap(role => role.permissions);

    const hasPermission = requiredPermissions.every(permission => userPermissions.includes(permission));

    if (!hasPermission) {
        return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
    }

    next();
};

export { verifyToken, authorize };
