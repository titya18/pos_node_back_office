import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { syncVatOrderToTarget } from "../services/syncVatOrderToTarget.service";
import { syncVatPaymentToTarget } from "../services/syncVatPaymentToTarget.service";
import { deleteVatPaymentFromTarget } from "../services/deleteVatPaymentFromTarget.service";

export const startVatSyncRetryJob = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const failedLogs = await prisma.vatSyncLog.findMany({
        where: {
          status: "FAILED",
          retryCount: { lt: 10 },
        },
        orderBy: {
          createdAt: "asc",
        },
        take: 20,
      });

      for (const log of failedLogs) {
        try {
          if (log.actionType === "UPSERT_ORDER") {
            await syncVatOrderToTarget(log.entityId);
          } else if (log.actionType === "UPSERT_PAYMENT") {
            await syncVatPaymentToTarget(log.entityId);
          } else if (log.actionType === "DELETE_PAYMENT") {
            await deleteVatPaymentFromTarget(log.entityId);
          }

          await prisma.vatSyncLog.update({
            where: { id: log.id },
            data: {
              status: "DONE",
              syncedAt: new Date(),
              errorMessage: null,
            },
          });
        } catch (error: any) {
          await prisma.vatSyncLog.update({
            where: { id: log.id },
            data: {
              retryCount: { increment: 1 },
              errorMessage: error?.message ?? "Retry failed",
            },
          });
        }
      }
    } catch (error) {
      console.error("VAT sync retry job error:", error);
    }
  });
};