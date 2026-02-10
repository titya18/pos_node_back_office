import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const searchProducts = async (req: Request, res: Response) => {
    // const { searchTerm, branchId } = req.query;

    try {
        const searchTerm = req.query.searchTerm as string;

        let branchId: number;

        if (req.user?.roleType !== "ADMIN") {
            // STAFF / USER → force their own branch
            branchId = Number(req.user?.branchId);
        } else {
            // ADMIN → must pass branchId in query
            if (!req.query.branchId) {
                return res.status(400).json({ message: "branchId is required for ADMIN" });
            }
            branchId = Number(req.query.branchId);
        }

        const productVariants = await prisma.productVariants.findMany({
            where: {
                isActive: 1,
                deletedAt: null,
                OR: [
                    { name: { contains: searchTerm as string, mode: "insensitive" } },
                    { barcode: { contains: searchTerm as string, mode: "insensitive" } },
                    { sku: { contains: searchTerm as string, mode: "insensitive" } },
                ]
            },
            select: {
                id: true,
                productId: true,
                name: true,
                productType: true,
                barcode: true,
                sku: true,
                purchasePrice: true,
                retailPrice: true,
                wholeSalePrice: true,
                products: {
                    select: {
                        id: true,
                        name: true,
                    }
                },
                stocks: {
                    where: {
                        branchId: Number(branchId),
                    },
                    select: {
                        id: true,
                        quantity: true,
                        branchId: true,
                    },
                },
            }
        });
        res.status(200).json(productVariants);
    } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ message: "Error fetching products" });
    }
};
