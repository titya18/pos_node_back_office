import { Request, Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import fs from "fs";
import logger from "../utils/logger";

const prisma = new PrismaClient();
const currentDate = new Date();

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
    : baseUnitId;

  if (costUnitId === baseUnitId) {
    return cost;
  }

  const conv = await tx.productUnitConversion.findUnique({
    where: {
      productId_fromUnitId_toUnitId: {
        productId,
        fromUnitId: costUnitId,
        toUnitId: baseUnitId,
      },
    },
    select: {
      multiplier: true,
    },
  });

  if (!conv || Number(conv.multiplier) <= 0) {
    throw new Error(
      `Missing conversion for cost unit. productId=${productId}, fromUnitId=${costUnitId}, toBaseUnitId=${baseUnitId}`
    );
  }

  return cost.div(new Decimal(conv.multiplier));
};