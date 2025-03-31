import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
import { log } from "console";

const prisma = new PrismaClient();

export const getAllPurchases = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "date"; // Default to a valid column
        const validSortFields = ["id", "userId", "branchId", "supplierId", "ref", "date", "taxRate", "taxNet", "discount", "shipping", "grandTotal", "status", "createdAt", "updatedAt"];
        if (!validSortFields.includes(sortField)) {
            res.status(400).json({ message: `Invalid sort field: ${sortField}` });
            return;
        }
        const sortOrder = req.query.sortOrder === "desc" ? "asc" : "desc";
        const skip = (pageNumber - 1) * pageSize;

        const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
        // Verify that loggedInUser is defined
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        // Dynamically construct the where condition
        const whereCondition: any = {
            deletedAt: null
        }

        // Apply branchId filter only for USER roleType
        if (loggedInUser.roleType === "USER" && loggedInUser.branchId) {
            whereCondition.branchId = loggedInUser.branchId;
        }

        if (searchTerm) {
            whereCondition.name = {
                contains: searchTerm,
                mode: "insensitive" // Case-Insensitive search
            }
        }

        const total = await prisma.productVariants.count({
            where: whereCondition
        });

        const purchases = await prisma.purchases.findMany({
            where: whereCondition,
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc"
            },
            take: pageSize,
            include: { 
                purchaseDetails: true,
                branch: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                suppliers: {
                    select: {
                        id: true,
                        name: true
                    }
                } 
            }
        });
        res.status(200).json({ data: purchases, total });
    } catch (error) {
        logger.error("Error fetching purchases:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const upsertPurchase = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { branchId, supplierId, date, taxRate, taxNet, discount, shipping, grandTotal, status, note, purchaseDetails } = req.body;
    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();
    
    try {
        const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
        // Verify that loggedInUser is defined
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        const purchaseId = id ? parseInt(id, 10) : undefined;
        if (purchaseId) {
            const checkPurchase = await prisma.purchases.findUnique({ where: { id: purchaseId } });
            if (!checkPurchase) {
                res.status(404).json({ message: "Purchase not found!" });
                return;
            }
        }

        // const checkExisting = await prisma.purchases.findFirst({
        //     where: {
        //         ref,
        //         branchId: parseInt(branchId, 10), // Ensure branchId is included in the condition
        //         id: purchaseId ? { not: purchaseId } : undefined, // Exclude the current purchase if updating
        //     },
        // });
        // if (checkExisting) {
        //     res.status(400).json({ message: "The reference code must be unique within the same branch." });
        //     return;
        // }
        let ref = "PR-";

        // Generate a new ref only for creation
        if (!id) {
            // Query for the highest ref in the same branch
            const lastPurchase = await prisma.purchases.findFirst({
                where: { branchId: parseInt(branchId, 10) },
                orderBy: { ref: 'desc' }, // Sort by ref in descending order
            });

            // Extract and increment the numeric part of the ref
            if (lastPurchase && lastPurchase.ref) {
                const refNumber = parseInt(lastPurchase.ref.split('-')[1], 10) || 0;
                ref += String(refNumber + 1).padStart(5, '0'); // Increment and format with leading zeros
            } else {
                ref += "00001"; // Start from 00001 if no ref exists for the branch
            }
        }

        const purchase = purchaseId
            ? await prisma.purchases.update({
                where: { id: purchaseId },
                data: {
                    userId: loggedInUser.id,
                    branchId: parseInt(branchId, 10),
                    supplierId: parseInt(supplierId, 10),
                    date,
                    taxRate,
                    taxNet,
                    discount,
                    shipping,
                    grandTotal,
                    status,
                    note,
                    updatedAt: utcNow.toJSDate(),
                    purchaseDetails: {
                        deleteMany: {}, // Delete existing purchase details
                        create: purchaseDetails.map((detail: any) => ({
                            productId: parseInt(detail.productId, 10),
                            productVariantId: parseInt(detail.productVariantId, 10),
                            code: detail.code,
                            cost: parseFloat(detail.cost),
                            taxNet: parseFloat(detail.taxNet),
                            taxMethod: detail.taxMethod,
                            discount: detail.discount ? parseFloat(detail.discount) : undefined,
                            discountMethod: detail.discountMethod,
                            total: parseFloat(detail.total),
                            quantity: parseInt(detail.quantity, 10),
                        })),
                    },
                }
            })
            : await prisma.purchases.create({
                data: {
                    userId: loggedInUser.id,
                    branchId: parseInt(branchId, 10),
                    supplierId: parseInt(supplierId, 10),
                    ref,
                    date,
                    taxRate,
                    taxNet,
                    discount,
                    shipping,
                    grandTotal,
                    status,
                    note,
                    createdAt: utcNow.toJSDate(),
                    updatedAt: utcNow.toJSDate(),
                    purchaseDetails: {
                        create: purchaseDetails.map((detail: any) => ({
                            productId: parseInt(detail.productId, 10),
                            productVariantId: parseInt(detail.productVariantId, 10),
                            code: detail.code,
                            cost: parseFloat(detail.cost),
                            taxNet: parseFloat(detail.taxNet),
                            taxMethod: detail.taxMethod,
                            discount: detail.disCount ? parseFloat(detail.disCount) : undefined,
                            discountMethod: detail.disCountMethod,
                            total: parseFloat(detail.total),
                            quantity: parseInt(detail.quantity, 10),
                        })),
                    },
                }
            });
        res.status(id ? 200 : 201).json(purchase);
    } catch (error) {
        logger.error("Error creating/updating purchase:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const insertPurchasePayment = async (req: Request, res: Response): Promise<void> => {
    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();
    try {
        const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
        // Verify that loggedInUser is defined
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        const { branchId, purchaseId, paymentMethodId, amount } = req.body;

        // Fetch the purchase to get the grandTotal
        const purchase = await prisma.purchases.findUnique({
            where: { id: purchaseId },
            select: { grandTotal: true, paidAmount: true },
        });

        if (!purchase) {
            res.status(404).json({ message: "Purchase not found" });
            return;
        }

        // Handle null for paidAmount by defaulting to 0 if it's null
        const paidAmountNumber = purchase.paidAmount ? purchase.paidAmount.toNumber() : 0;
        const amountNumber = Number(amount); // Convert amount to number if it's not already

        // Calculate the new paidAmount
        const newPaidAmount = purchase.grandTotal.toNumber() <= amountNumber 
            ? purchase.grandTotal.toNumber() 
            : (purchase.grandTotal.toNumber() - paidAmountNumber) <= amountNumber
            ? purchase.grandTotal.toNumber() 
            : (paidAmountNumber + amountNumber); // Now properly add as numbers

        await prisma.purchases.update({
            where: { id: purchaseId },
            data: { paidAmount: newPaidAmount }
        });
        
        const purchasePayment = await prisma.purchaseOnPayments.create({
            data: {
                branchId: parseInt(branchId, 10),
                purchaseId: parseInt(purchaseId, 10),
                paymentMethodId: parseInt(paymentMethodId, 10),
                userId: loggedInUser.id,
                amount,
                createdAt: utcNow.toJSDate()
            }
        });
        res.status(201).json(purchasePayment);
    } catch (error) {
        logger.error("Error inserting purchase payment:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}

export const getPurchaseById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const purchase = await prisma.purchases.findUnique({
            where: { id: parseInt(id, 10) },
            include: { 
                purchaseDetails: {
                    include: {
                        products: true, // Include related products data
                        productvariants: {
                            select: {
                                name: true, // Select the `name` field from `productVariant`
                            },
                        },
                    },
                },
            }, // Include related purchase details
        });

        // Transform data to flatten `name` into `purchaseDetails`
        if (purchase) {
            purchase.purchaseDetails = purchase.purchaseDetails.map((detail: any) => ({
                ...detail,
                name: detail.productvariants.name, // Add `name` directly
            }));
        }

        if (!purchase) {
            res.status(404).json({ message: "Purchase not found!" });
            return;
        }

        if (!purchase) {
            res.status(404).json({ message: "Purchase not found!" });
            return;
        }
        res.status(200).json(purchase);
    } catch (error) {
        logger.error("Error fetching purchase by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getPurchasePaymentById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const purchasePayment = await prisma.purchaseOnPayments.findMany({ 
            where: { purchaseId: parseInt(id, 10) },
            orderBy: { id: 'desc' },
            include: {
                paymentMethods: {
                    select: {
                        name: true
                    }
                }
            } 
        });
        res.status(200).json(purchasePayment);
    } catch (error) {
        logger.error("Error fetching purchase payment by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}

export const deletePurchase = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    try {
        const purchase = await prisma.purchases.findUnique({ 
            where: { id: parseInt(id, 10) },
            include: { purchaseDetails: true } 
        });
        if (!purchase) {
            res.status(404).json({ message: "Purchase not found!" });
            return;
        }
        await prisma.purchases.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: utcNow.toJSDate()
            }
        });
        res.status(200).json(purchase);
    } catch (error) {
        logger.error("Error deleting purchase:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};