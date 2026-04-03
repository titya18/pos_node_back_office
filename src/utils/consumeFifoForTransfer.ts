import { Prisma, PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

type TxClient = Prisma.TransactionClient;

interface ConsumeFifoForTransferParams {
  tx: TxClient;
  productVariantId: number;
  fromBranchId: number;
  toBranchId: number;
  transferDetailId: number;
  qtyToTransfer: Decimal;
  userId: number | null;
  currentDate: Date;
  note: string;
}

export const consumeFifoForTransfer = async ({
  tx,
  productVariantId,
  fromBranchId,
  toBranchId,
  transferDetailId,
  qtyToTransfer,
  userId,
  currentDate,
  note,
}: ConsumeFifoForTransferParams): Promise<void> => {
  let qtyLeft = new Decimal(qtyToTransfer);

  const fifoBatches = await tx.stockMovements.findMany({
    where: {
      productVariantId,
      branchId: fromBranchId,
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

    const moveQty = Decimal.min(availableQty, qtyLeft);
    const layerCost = batch.unitCost ?? new Decimal(0);

    // 1) Transfer OUT from source branch
    const outMovement = await tx.stockMovements.create({
      data: {
        productVariantId,
        branchId: fromBranchId,
        type: "TRANSFER",
        status: "APPROVED",
        quantity: moveQty.neg(),
        unitCost: layerCost,
        sourceMovementId: batch.id,
        transferDetailId,
        note,
        createdAt: currentDate,
        createdBy: userId,
        approvedAt: currentDate,
        approvedBy: userId,
      },
    });

    // 2) Reduce remaining qty from source layer
    await tx.stockMovements.update({
      where: { id: batch.id },
      data: {
        remainingQty: availableQty.minus(moveQty),
        updatedAt: currentDate,
        updatedBy: userId,
      },
    });

    // 3) Transfer IN to destination branch with same cost
    await tx.stockMovements.create({
      data: {
        productVariantId,
        branchId: toBranchId,
        type: "TRANSFER",
        status: "APPROVED",
        quantity: moveQty,
        remainingQty: moveQty,
        unitCost: layerCost,
        sourceMovementId: outMovement.id,
        transferDetailId,
        note,
        createdAt: currentDate,
        createdBy: userId,
        approvedAt: currentDate,
        approvedBy: userId,
      },
    });

    qtyLeft = qtyLeft.minus(moveQty);
  }

  if (qtyLeft.gt(0)) {
    throw new Error(
      `Not enough FIFO stock to transfer for productVariantId=${productVariantId}. Missing ${qtyLeft.toString()}`
    );
  }
};