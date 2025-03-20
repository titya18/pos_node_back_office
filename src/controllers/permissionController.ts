import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const getAllPermissions = async (req: Request, res: Response): Promise<void> => {
    try {
        const permissions = await prisma.permission.findMany();
        res.status(200).json(permissions);
    } catch (error) {
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}