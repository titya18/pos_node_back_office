import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const searchProducts = async (req: Request, res: Response) => {
    const { searchTerm } = req.query;

    try {
        // const products = await prisma.products.findMany({
        //     where: {
        //         isActive: 1,
        //         deletedAt: null,
        //         OR: [
        //             { name: { contains: searchTerm as string, mode: "insensitive" } },
        //             {
        //                 productvariants: {
        //                     some: {
        //                         isActive: 1,
        //                         deletedAt: null,
        //                         OR: [
        //                             { name: { contains: searchTerm as string, mode: "insensitive" } },
        //                             { code: { contains: searchTerm as string, mode: "insensitive" } },
        //                         ],
        //                     },
        //                 },
        //             },
        //         ],
        //     },
        //     select: {
        //         id: true,
        //         name: true,
        //         productvariants: {
        //             where: {
        //                 isActive: 1,
        //                 deletedAt: null,
        //             },
        //             select: {
        //                 id: true,
        //                 name: true,
        //                 code: true,
        //             },
        //         },
        //     },
        // });

        // res.status(200).json(products);

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
                }
            }
        });

        console.log(productVariants);


        res.status(200).json(productVariants);
    } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ message: "Error fetching products" });
    }
};
