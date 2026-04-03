-- AlterTable
ALTER TABLE "StockMovements" ADD COLUMN     "remainingQty" DECIMAL(10,4),
ADD COLUMN     "sourceMovementId" INTEGER;
