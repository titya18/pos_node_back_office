import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

type TxClient = Prisma.TransactionClient;

interface ConsumeFifoForAdjustmentParams {
  tx: TxClient;
  productVariantId: number;
  branchId: number;
  qtyToReduce: Decimal;
  userId: number | null;
  currentDate: Date;
  note: string;
}

export const consumeFifoForNegativeAdjustment = async ({
  tx,
  productVariantId,
  branchId,
  qtyToReduce,
  userId,
  currentDate,
  note,
}: ConsumeFifoForAdjustmentParams): Promise<void> => {
  let qtyLeft = new Decimal(qtyToReduce);

  const fifoBatches = await tx.stockMovements.findMany({
    where: {
      productVariantId,
      branchId,
      status: "APPROVED",
      remainingQty: { gt: 0 },
      OR: [
        { type: "PURCHASE" },
        { type: "RETURN" },
        { type: "SALE_RETURN" },
        { type: "ADJUSTMENT", AdjustMentType: "POSITIVE" },
        { type: "TRANSFER", quantity: { gt: 0 } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  for (const batch of fifoBatches) {
    if (qtyLeft.lte(0)) break;

    const availableQty = batch.remainingQty ?? new Decimal(0);
    if (availableQty.lte(0)) continue;

    const consumeQty = Decimal.min(availableQty, qtyLeft);

    await tx.stockMovements.create({
      data: {
        productVariantId,
        branchId,
        type: "ADJUSTMENT",
        AdjustMentType: "NEGATIVE",
        status: "APPROVED",
        quantity: consumeQty.neg(),
        unitCost: batch.unitCost ?? new Decimal(0),
        sourceMovementId: batch.id,
        note,
        createdAt: currentDate,
        createdBy: userId,
        approvedAt: currentDate,
        approvedBy: userId,
      },
    });

    await tx.stockMovements.update({
      where: { id: batch.id },
      data: {
        remainingQty: availableQty.minus(consumeQty),
        updatedAt: currentDate,
        updatedBy: userId,
      },
    });

    qtyLeft = qtyLeft.minus(consumeQty);
  }

  if (qtyLeft.gt(0)) {
    throw new Error(
      `Not enough FIFO stock to reduce for productVariantId=${productVariantId}. Missing ${qtyLeft.toString()}`
    );
  }
};

interface AddPositiveAdjustmentParams {
  tx: TxClient;
  productVariantId: number;
  branchId: number;
  qtyToAdd: Decimal;
  unitCost: Decimal;
  userId: number | null;
  currentDate: Date;
  note: string;
}

export const addPositiveAdjustmentLayer = async ({
  tx,
  productVariantId,
  branchId,
  qtyToAdd,
  unitCost,
  userId,
  currentDate,
  note,
}: AddPositiveAdjustmentParams): Promise<void> => {
  await tx.stockMovements.create({
    data: {
      productVariantId,
      branchId,
      type: "ADJUSTMENT",
      AdjustMentType: "POSITIVE",
      status: "APPROVED",
      quantity: qtyToAdd,
      remainingQty: qtyToAdd,
      unitCost,
      note,
      createdAt: currentDate,
      createdBy: userId,
      approvedAt: currentDate,
      approvedBy: userId,
    },
  });
};

export const getOperationValueToBase = async (
  tx: Prisma.TransactionClient,
  productId: number,
  baseUnitId: number,
  selectedUnitId: number
): Promise<Decimal> => {
  if (Number(selectedUnitId) === Number(baseUnitId)) {
    return new Decimal(1);
  }

  const directConv = await tx.productUnitConversion.findUnique({
    where: {
      productId_fromUnitId_toUnitId: {
        productId,
        fromUnitId: Number(selectedUnitId),
        toUnitId: Number(baseUnitId),
      },
    },
    select: { multiplier: true },
  });

  if (directConv && Number(directConv.multiplier) > 0) {
    return new Decimal(directConv.multiplier);
  }

  const reverseConv = await tx.productUnitConversion.findUnique({
    where: {
      productId_fromUnitId_toUnitId: {
        productId,
        fromUnitId: Number(baseUnitId),
        toUnitId: Number(selectedUnitId),
      },
    },
    select: { multiplier: true },
  });

  if (reverseConv && Number(reverseConv.multiplier) > 0) {
    return new Decimal(1).div(new Decimal(reverseConv.multiplier));
  }

  throw new Error(
    `Missing unit conversion. productId=${productId}, selectedUnitId=${selectedUnitId}, baseUnitId=${baseUnitId}`
  );
};

export const resolveCostPerBaseUnit = async (
  tx: Prisma.TransactionClient,
  productId: number,
  baseUnitId: number,
  purchasePriceValue: number | string,
  purchasePriceUnitIdValue: number | null | undefined
): Promise<Decimal> => {
  const cost = new Decimal(purchasePriceValue ?? 0);

  if (cost.lte(0)) {
    return new Decimal(0);
  }

  const costUnitId = purchasePriceUnitIdValue
    ? Number(purchasePriceUnitIdValue)
    : Number(baseUnitId);

  const operationValue = await getOperationValueToBase(
    tx,
    productId,
    Number(baseUnitId),
    costUnitId
  );

  if (operationValue.lte(0)) {
    throw new Error("Invalid operation value for purchase cost conversion");
  }

  return cost.div(operationValue);
};

export const resolvePricePerBaseUnit = async (
  tx: Prisma.TransactionClient,
  productId: number,
  baseUnitId: number,
  priceValue: number | string,
  priceUnitIdValue: number | null | undefined
): Promise<Decimal> => {
  const price = new Decimal(priceValue ?? 0);

  if (price.lte(0)) {
    return new Decimal(0);
  }

  const priceUnitId = priceUnitIdValue
    ? Number(priceUnitIdValue)
    : Number(baseUnitId);

  const operationValue = await getOperationValueToBase(
    tx,
    productId,
    Number(baseUnitId),
    priceUnitId
  );

  if (operationValue.lte(0)) {
    throw new Error("Invalid operation value for price conversion");
  }

  return price.div(operationValue);
};

export const computeBaseQty = async (
  tx: Prisma.TransactionClient,
  detail: any
): Promise<{
  unitId: number;
  unitQty: Decimal;
  baseQty: Decimal;
  baseUnitId: number;
  productId: number;
}> => {
  const productId = Number(detail.productId);
  const unitId = Number(detail.unitId);
  const unitQty = new Decimal(detail.unitQty ?? detail.quantity ?? 0);

  if (!productId || !unitId) {
    throw new Error("Product ID and Unit ID are required");
  }

  if (unitQty.lte(0)) {
    throw new Error("Quantity must be greater than zero");
  }

  const variant = await tx.productVariants.findUnique({
    where: { id: Number(detail.productVariantId) },
    select: {
      id: true,
      productId: true,
      baseUnitId: true,
    },
  });

  if (!variant) {
    throw new Error(`Product variant not found: ${detail.productVariantId}`);
  }

  if (!variant.baseUnitId) {
    throw new Error(`Base unit not found for productVariantId=${variant.id}`);
  }

  const operationValue = await getOperationValueToBase(
    tx,
    variant.productId,
    variant.baseUnitId,
    unitId
  );

  const baseQty = unitQty.mul(operationValue);

  return {
    unitId,
    unitQty,
    baseQty,
    baseUnitId: variant.baseUnitId,
    productId: variant.productId,
  };
};

export const calculatePurchaseLineTotal = (detail: any): Decimal => {
  const cost = new Decimal(detail.cost ?? 0);
  const qty = new Decimal(detail.unitQty ?? detail.quantity ?? 0);
  const discount = new Decimal(detail.discount ?? 0);
  const taxRate = new Decimal(detail.taxNet ?? 0);

  let priceAfterDiscount = cost;

  if (detail.discountMethod === "Percent") {
    priceAfterDiscount = cost.mul(new Decimal(1).minus(discount.div(100)));
  } else {
    priceAfterDiscount = cost.minus(discount);
  }

  let unitTotal = priceAfterDiscount;

  if (detail.taxMethod === "Exclude") {
    unitTotal = priceAfterDiscount.plus(priceAfterDiscount.mul(taxRate).div(100));
  }

  if (detail.taxMethod === "Include") {
    unitTotal = priceAfterDiscount;
  }

  return unitTotal.mul(qty);
};