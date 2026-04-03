/*
  Warnings:

  - A unique constraint covering the columns `[sourceSystem,sourceOrderId]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[sourceSystem,sourcePaymentId]` on the table `OrderOnPayments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "sourceOrderId" INTEGER,
ADD COLUMN     "sourceRef" VARCHAR(50),
ADD COLUMN     "sourceSystem" VARCHAR(50);

-- AlterTable
ALTER TABLE "OrderOnPayments" ADD COLUMN     "sourcePaymentId" INTEGER,
ADD COLUMN     "sourceSystem" VARCHAR(50);

-- CreateTable
CREATE TABLE "VatSyncLog" (
    "id" SERIAL NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "entityId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "sourceSystem" VARCHAR(50) NOT NULL,
    "actionType" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" VARCHAR(2000),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VatSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VatSyncLog_status_retryCount_idx" ON "VatSyncLog"("status", "retryCount");

-- CreateIndex
CREATE INDEX "VatSyncLog_orderId_idx" ON "VatSyncLog"("orderId");

-- CreateIndex
CREATE INDEX "Order_sourceSystem_idx" ON "Order"("sourceSystem");

-- CreateIndex
CREATE INDEX "Order_sourceOrderId_idx" ON "Order"("sourceOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_sourceSystem_sourceOrderId_key" ON "Order"("sourceSystem", "sourceOrderId");

-- CreateIndex
CREATE INDEX "OrderOnPayments_sourceSystem_idx" ON "OrderOnPayments"("sourceSystem");

-- CreateIndex
CREATE INDEX "OrderOnPayments_sourcePaymentId_idx" ON "OrderOnPayments"("sourcePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderOnPayments_sourceSystem_sourcePaymentId_key" ON "OrderOnPayments"("sourceSystem", "sourcePaymentId");
