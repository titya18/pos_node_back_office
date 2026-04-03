import { Request, Response } from "express";
import { prisma } from "../lib/prisma";


export const searchProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const searchTerm = (req.query.searchTerm as string) || "";

    let branchId: number;

    if (req.user?.roleType !== "ADMIN") {
      branchId = Number(req.user?.branchId);
    } else {
      if (!req.query.branchId) {
        res.status(400).json({ message: "branchId is required for ADMIN" });
        return;
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
        trackingType: true,

        purchasePrice: true,
        purchasePriceUnitId: true,
        purchasePriceUnit: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },

        retailPrice: true,
        retailPriceUnitId: true,
        retailPriceUnit: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },

        wholeSalePrice: true,
        wholeSalePriceUnitId: true,
        wholeSalePriceUnit: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },

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
          where: { branchId },
          select: {
            id: true,
            quantity: true,
            branchId: true,
          },
        },
      },
    });

    const result = productVariants.map((pv) => {
      const conversions = pv.products?.unitConversions ?? [];

      const getOperationValue = (unitId: number) => {
        if (Number(pv.baseUnitId) === Number(unitId)) return 1;

        const direct = conversions.find(
          (c) =>
            Number(c.fromUnitId) === Number(unitId) &&
            Number(c.toUnitId) === Number(pv.baseUnitId)
        );
        if (direct && Number(direct.multiplier) > 0) {
          return Number(direct.multiplier);
        }

        const reverse = conversions.find(
          (c) =>
            Number(c.fromUnitId) === Number(pv.baseUnitId) &&
            Number(c.toUnitId) === Number(unitId)
        );
        if (reverse && Number(reverse.multiplier) > 0) {
          return 1 / Number(reverse.multiplier);
        }

        return 1;
      };

      const purchaseMasterUnitId = Number(pv.purchasePriceUnitId ?? pv.baseUnitId ?? 0);
      const retailMasterUnitId = Number(pv.retailPriceUnitId ?? pv.baseUnitId ?? 0);
      const wholesaleMasterUnitId = Number(pv.wholeSalePriceUnitId ?? pv.baseUnitId ?? 0);

      const purchaseMasterValue = Number(pv.purchasePrice ?? 0);
      const retailMasterValue = Number(pv.retailPrice ?? 0);
      const wholesaleMasterValue = Number(pv.wholeSalePrice ?? 0);

      const purchaseBaseValue =
        getOperationValue(purchaseMasterUnitId) > 0
          ? purchaseMasterValue / getOperationValue(purchaseMasterUnitId)
          : 0;

      const retailBaseValue =
        getOperationValue(retailMasterUnitId) > 0
          ? retailMasterValue / getOperationValue(retailMasterUnitId)
          : 0;

      const wholesaleBaseValue =
        getOperationValue(wholesaleMasterUnitId) > 0
          ? wholesaleMasterValue / getOperationValue(wholesaleMasterUnitId)
          : 0;

      const unitMap = new Map<
        number,
        {
          unitId: number;
          unitName: string;
          operationValue: number;
          isBaseUnit: boolean;
          suggestedPurchaseCost: number;
          suggestedRetailPrice: number;
          suggestedWholesalePrice: number;
        }
      >();

      if (pv.baseUnit) {
        unitMap.set(pv.baseUnit.id, {
          unitId: pv.baseUnit.id,
          unitName: pv.baseUnit.name,
          operationValue: 1,
          isBaseUnit: true,
          suggestedPurchaseCost: Number((purchaseBaseValue * 1).toFixed(6)),
          suggestedRetailPrice: Number((retailBaseValue * 1).toFixed(6)),
          suggestedWholesalePrice: Number((wholesaleBaseValue * 1).toFixed(6)),
        });
      }

      for (const conv of conversions) {
        if (Number(pv.baseUnitId) === Number(conv.toUnitId) && conv.fromUnit) {
          const opValue = Number(conv.multiplier ?? 1);

          unitMap.set(conv.fromUnit.id, {
            unitId: conv.fromUnit.id,
            unitName: conv.fromUnit.name,
            operationValue: opValue,
            isBaseUnit: false,
            suggestedPurchaseCost: Number((purchaseBaseValue * opValue).toFixed(6)),
            suggestedRetailPrice: Number((retailBaseValue * opValue).toFixed(6)),
            suggestedWholesalePrice: Number((wholesaleBaseValue * opValue).toFixed(6)),
          });
        }

        if (Number(pv.baseUnitId) === Number(conv.fromUnitId) && conv.toUnit) {
          const multiplier = Number(conv.multiplier ?? 1);
          const opValue = multiplier === 0 ? 1 : 1 / multiplier;

          unitMap.set(conv.toUnit.id, {
            unitId: conv.toUnit.id,
            unitName: conv.toUnit.name,
            operationValue: opValue,
            isBaseUnit: false,
            suggestedPurchaseCost: Number((purchaseBaseValue * opValue).toFixed(6)),
            suggestedRetailPrice: Number((retailBaseValue * opValue).toFixed(6)),
            suggestedWholesalePrice: Number((wholesaleBaseValue * opValue).toFixed(6)),
          });
        }
      }

      return {
        ...pv,
        defaultPurchaseUnitId: purchaseMasterUnitId,
        defaultRetailUnitId: retailMasterUnitId,
        defaultWholesaleUnitId: wholesaleMasterUnitId,
        purchasePricePerBase: Number(purchaseBaseValue.toFixed(6)),
        retailPricePerBase: Number(retailBaseValue.toFixed(6)),
        wholesalePricePerBase: Number(wholesaleBaseValue.toFixed(6)),
        unitOptions: Array.from(unitMap.values()),
      };
    });

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Error fetching products" });
  }
};