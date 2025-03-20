import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
import { log } from "console";

const prisma = new PrismaClient();

export const getAllPaymentMethods = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "desc" : "asc";
        const skip = (pageNumber - 1) * pageSize;

        const whereCondition: any = {
            deletedAt: null // Only include records where deletedAt is null
        }

        if (searchTerm) {
            whereCondition.name = {
                contains: searchTerm,
                mode: "insensitive" // Case-insensitive search
            }
        }

        const total = await prisma.paymentMethods.count({
            where: whereCondition
        });

        const paymentMethods = await prisma.paymentMethods.findMany({
            where: whereCondition,
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc"
            },
            take: pageSize
        });
        res.status(200).json({ data: paymentMethods, total });
    } catch (error) {
        logger.error("Error fetching payment methods:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name } = req.body;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();

    try {
        const paymentId = id ? parseInt(id, 10) : undefined;
        if (paymentId) {
            const checkPayment = await prisma.paymentMethods.findUnique({ where: { id: paymentId } });
            if (!checkPayment) {
                res.status(404).json({ message: "Payment method not found!"});
                return;
            }
        }

        const checkExisting = await prisma.paymentMethods.findFirst({
            where: {
                name,
                id: { not: paymentId }
            }
        });
        if (checkExisting) {
            res.status(400).json({ message: "Payment method name must be unique"});
            return;
        }

        const paymentmethod = id
            ? await prisma.paymentMethods.update({
                where: { id: paymentId },
                data: {
                    name,
                    updatedAt: utcNow.toJSDate()
                }
            })
            : await prisma.paymentMethods.create({
                data: {
                    name,
                    createdAt: utcNow.toJSDate(),
                    updatedAt: utcNow.toJSDate()
                }
            });
        res.status(id ? 200 : 201).json(paymentmethod);
    } catch (error) {
        logger.error("Error upserting payment method:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getPaymentMethodById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const paymentMethod = await prisma.paymentMethods.findUnique({ where: { id: parseInt(id, 10) } });
        if (!paymentMethod) {
            res.status(404).json({ message: "Payment method not found!" });
            return;
        }
        res.status(200).json(paymentMethod);
    } catch (error) {
        logger.error("Error fetching payment method by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deletePaymentMethod = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    try {
        const paymentMethod = await prisma.paymentMethods.findUnique({ where : { id: parseInt(id, 10) } });
        if (!paymentMethod) {
            res.status(404).json({ message: "Payment method not found!" });
            return;
        }
        await prisma.paymentMethods.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: utcNow.toJSDate()
            }
        });
        res.status(200).json(paymentMethod);
    } catch (error) {
        logger.error("Error deleting payment method:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}