import { prisma } from "../lib/prisma";

type CreateVatSyncLogInput = {
  entityType: "ORDER" | "PAYMENT";
  entityId: number;
  orderId?: number | null;
  actionType: "UPSERT_ORDER" | "UPSERT_PAYMENT" | "DELETE_PAYMENT";
  status: "PENDING" | "DONE" | "FAILED";
  errorMessage?: string | null;
  syncedAt?: Date | null;
};

export const createVatSyncLog = async (input: CreateVatSyncLogInput) => {
  return prisma.vatSyncLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      orderId: input.orderId ?? null,
      sourceSystem: process.env.VAT_SYNC_SOURCE_SYSTEM || "inventory",
      actionType: input.actionType,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      syncedAt: input.syncedAt ?? null,
    },
  });
};