import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

type TxClient = Prisma.TransactionClient;

interface ConsumeFifoParams {
  tx: TxClient;
  productVariantId: number;
  branchId: number;
  orderItemId: number;
  invoiceRef: string;
  sellQty: Decimal;
  userId: number;
  currentDate: Date;
}

export const consumeFifoForSale = async ({
  tx,
  productVariantId,
  branchId,
  orderItemId,
  invoiceRef,
  sellQty,
  userId,
  currentDate,
}: ConsumeFifoParams): Promise<Decimal> => {
  let qtyToSell = new Decimal(sellQty);
  let totalCogs = new Decimal(0);

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
    if (qtyToSell.lte(0)) break;

    const availableQty = batch.remainingQty ?? new Decimal(0);
    if (availableQty.lte(0)) continue;

    const consumeQty = Decimal.min(availableQty, qtyToSell);
    const batchUnitCost = batch.unitCost ?? new Decimal(0);
    const lineCost = consumeQty.mul(batchUnitCost);

    await tx.stockMovements.create({
      data: {
        productVariantId,
        branchId,
        orderItemId,
        type: "ORDER",
        status: "APPROVED",
        quantity: consumeQty.neg(),
        unitCost: batchUnitCost,
        sourceMovementId: batch.id,
        note: `Invoice #${invoiceRef}`,
        createdBy: userId,
        createdAt: currentDate,
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

    totalCogs = totalCogs.plus(lineCost);
    qtyToSell = qtyToSell.minus(consumeQty);
  }

  if (qtyToSell.gt(0)) {
    throw new Error(
      `Not enough FIFO stock for productVariantId=${productVariantId}. Missing ${qtyToSell.toString()}`
    );
  }

  return totalCogs;
};