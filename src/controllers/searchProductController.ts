// import { Request, Response } from "express";
// import { PrismaClient } from "@prisma/client";

// const prisma = new PrismaClient();

// export const searchProducts = async (req: Request, res: Response) => {
//     // const { searchTerm, branchId } = req.query;

//     try {
//         const searchTerm = req.query.searchTerm as string;

//         let branchId: number;

//         if (req.user?.roleType !== "ADMIN") {
//             // STAFF / USER → force their own branch
//             branchId = Number(req.user?.branchId);
//         } else {
//             // ADMIN → must pass branchId in query
//             if (!req.query.branchId) {
//                 return res.status(400).json({ message: "branchId is required for ADMIN" });
//             }
//             branchId = Number(req.query.branchId);
//         }

//         const productVariants = await prisma.productVariants.findMany({
//             where: {
//                 isActive: 1,
//                 deletedAt: null,
//                 OR: [
//                     { name: { contains: searchTerm as string, mode: "insensitive" } },
//                     { barcode: { contains: searchTerm as string, mode: "insensitive" } },
//                     { sku: { contains: searchTerm as string, mode: "insensitive" } },
//                 ]
//             },
//             select: {
//                 id: true,
//                 productId: true,
//                 name: true,
//                 productType: true,
//                 barcode: true,
//                 sku: true,
//                 purchasePrice: true,
//                 retailPrice: true,
//                 wholeSalePrice: true,

//                 // ✅ base unit
//                 baseUnitId: true,
//                 baseUnit: {
//                     select: { id: true, name: true, type: true },
//                 },

//                 products: {
//                     select: {
//                         id: true,
//                         name: true,

//                         // ✅ conversions for this product
//                         unitConversions: {
//                             select: {
//                                 id: true,
//                                 productId: true,
//                                 fromUnitId: true,
//                                 toUnitId: true,
//                                 multiplier: true,
//                                 fromUnit: { select: { id: true, name: true, type: true } },
//                                 toUnit: { select: { id: true, name: true, type: true } },
//                             },
//                         },
//                     }
//                 },
//                 stocks: {
//                     where: {
//                         branchId: Number(branchId),
//                     },
//                     select: {
//                         id: true,
//                         quantity: true,
//                         branchId: true,
//                     },
//                 },
//             }
//         });

//         // ✅ build unitOptions per variant
//         const result = productVariants.map((pv) => {
//             const optionsMap = new Map<number, { id: number; name: string; type: string }>();

//             // include base unit
//             if (pv.baseUnit) {
//                 optionsMap.set(pv.baseUnit.id, pv.baseUnit);
//             }

//             // include all units used in conversions
//             const conversions = pv.products?.unitConversions ?? [];
//             for (const c of conversions) {
//                 if (c.fromUnit) optionsMap.set(c.fromUnit.id, c.fromUnit);
//                 if (c.toUnit) optionsMap.set(c.toUnit.id, c.toUnit);
//             }

//             const unitOptions = Array.from(optionsMap.values());

//             return {
//                 ...pv,
//                 unitOptions, // ✅ front-end will use this
//             };
//         });

//         res.status(200).json(result);
//     } catch (error) {
//         console.error("Error fetching products:", error);
//         res.status(500).json({ message: "Error fetching products" });
//     }
// };

import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const searchProducts = async (req: Request, res: Response) => {
    try {
        const searchTerm = (req.query.searchTerm as string) || "";

        let branchId: number;

        if (req.user?.roleType !== "ADMIN") {
            branchId = Number(req.user?.branchId);
        } else {
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
                    { name: { contains: searchTerm, mode: "insensitive" } },
                    { barcode: { contains: searchTerm, mode: "insensitive" } },
                    { sku: { contains: searchTerm, mode: "insensitive" } },
                ],
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

                baseUnitId: true,
                baseUnit: {
                    select: {
                        id: true,
                        name: true,
                        type: true,
                    },
                },

                products: {
                    select: {
                        id: true,
                        name: true,
                        unitConversions: {
                            select: {
                                id: true,
                                productId: true,
                                fromUnitId: true,
                                toUnitId: true,
                                multiplier: true,
                                fromUnit: {
                                    select: {
                                        id: true,
                                        name: true,
                                        type: true,
                                    },
                                },
                                toUnit: {
                                    select: {
                                        id: true,
                                        name: true,
                                        type: true,
                                    },
                                },
                            },
                        },
                    },
                },

                stocks: {
                    where: {
                        branchId,
                    },
                    select: {
                        id: true,
                        quantity: true,
                        branchId: true,
                    },
                },
            },
        });

        const result = productVariants.map((pv) => {
            const unitMap = new Map<
                number,
                {
                    unitId: number;
                    unitName: string;
                    operationValue: number;
                    isBaseUnit: boolean;
                }
            >();

            // 1) add base unit first
            if (pv.baseUnit) {
                unitMap.set(pv.baseUnit.id, {
                    unitId: pv.baseUnit.id,
                    unitName: pv.baseUnit.name,
                    operationValue: 1,
                    isBaseUnit: true,
                });
            }

            // 2) add converted units
            const conversions = pv.products?.unitConversions ?? [];

            for (const conv of conversions) {
                // If conversion is Roll -> Meter with multiplier 305
                // and base unit is Meter, then:
                // Roll should have operationValue = 305
                // Meter should already be 1

                if (pv.baseUnitId === conv.toUnitId && conv.fromUnit) {
                    unitMap.set(conv.fromUnit.id, {
                        unitId: conv.fromUnit.id,
                        unitName: conv.fromUnit.name,
                        operationValue: Number(conv.multiplier ?? 1),
                        isBaseUnit: false,
                    });
                }

                // In case base unit is fromUnit and other unit is toUnit
                // Example if schema is Meter -> Roll, multiplier maybe inverse
                if (pv.baseUnitId === conv.fromUnitId && conv.toUnit) {
                    const multiplier = Number(conv.multiplier ?? 1);

                    unitMap.set(conv.toUnit.id, {
                        unitId: conv.toUnit.id,
                        unitName: conv.toUnit.name,
                        operationValue: multiplier === 0 ? 1 : 1 / multiplier,
                        isBaseUnit: false,
                    });
                }
            }

            return {
                ...pv,
                unitOptions: Array.from(unitMap.values()),
            };
        });

        res.status(200).json(result);
    } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ message: "Error fetching products" });
    }
};
