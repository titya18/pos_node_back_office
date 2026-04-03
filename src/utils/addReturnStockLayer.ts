import { Prisma, MovementType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

interface AddReturnLayerParams {
  tx: Prisma.TransactionClient;
  productVariantId: number;
  branchId: number;
  qtyToAdd: Decimal;
  unitCost: Decimal;
  userId: number;
  currentDate: Date;
  note?: string | null;
  returnDetailId?: number;
}

export const addReturnStockLayer = async ({
  tx,
  productVariantId,
  branchId,
  qtyToAdd,
  unitCost,
  userId,
  currentDate,
  note,
  returnDetailId,
}: AddReturnLayerParams) => {
  await tx.stockMovements.create({
    data: {
      productVariantId,
      branchId,
      type: "RETURN",
      status: "APPROVED",
      quantity: qtyToAdd,
      unitCost,
      note: note ?? null,
      createdBy: userId,
      createdAt: currentDate,
      approvedBy: userId,
      approvedAt: currentDate,
      returnDetailId,
    },
  });
};

interface ResolveReturnCostParams {
  tx: Prisma.TransactionClient;
  productVariantId: number;
  branchId: number;
}

export const resolveReturnCostPerBaseUnit = async ({
  tx,
  productVariantId,
  branchId,
}: ResolveReturnCostParams): Promise<Decimal> => {
  const preferredInboundTypes: MovementType[] = [
    "PURCHASE",
    "RETURN",
    "ADJUSTMENT",
    "TRANSFER",
    "SALE_RETURN",
  ];

  const latestInboundMovement = await tx.stockMovements.findFirst({
    where: {
      productVariantId,
      branchId,
      unitCost: {
        not: null,
      },
      type: {
        in: preferredInboundTypes,
      },
      status: "APPROVED",
    },
    orderBy: [
      { approvedAt: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: {
      unitCost: true,
      type: true,
    },
  });

  const unitCost = new Decimal(latestInboundMovement?.unitCost ?? 0);

  if (unitCost.lte(0)) {
    throw new Error(
      `Cannot resolve return cost for product variant ID ${productVariantId}. No approved inbound movement with valid cost was found.`
    );
  }

  return unitCost;
};