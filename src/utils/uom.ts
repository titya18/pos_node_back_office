// src/utils/uom.ts
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export async function computeBaseQty(
  tx: Prisma.TransactionClient,
  detail: any
): Promise<{ unitId: number; unitQty: Decimal; baseQty: Decimal; baseUnitId: number; productId: number }> {
  const variantId = Number(detail.productVariantId);

  const variant = await tx.productVariants.findUnique({
    where: { id: variantId },
    select: { productId: true, baseUnitId: true },
  });

  if (!variant?.baseUnitId) {
    throw new Error(`Variant ${variantId} has no baseUnitId`);
  }

  const baseUnitId = variant.baseUnitId;

  const unitId = detail.unitId ? Number(detail.unitId) : baseUnitId;
  const unitQty = new Decimal(detail.unitQty ?? detail.quantity ?? 0);

  let baseQty = unitQty;

  if (unitId !== baseUnitId) {
    const conv = await tx.productUnitConversion.findUnique({
      where: {
        productId_fromUnitId_toUnitId: {
          productId: variant.productId,
          fromUnitId: unitId,
          toUnitId: baseUnitId,
        },
      },
      select: { multiplier: true },
    });

    if (!conv) {
      throw new Error(
        `Missing conversion: productId=${variant.productId}, fromUnit=${unitId}, toBaseUnit=${baseUnitId}`
      );
    }

    baseQty = unitQty.mul(conv.multiplier);
  }

  return { unitId, unitQty, baseQty, baseUnitId, productId: variant.productId };
}