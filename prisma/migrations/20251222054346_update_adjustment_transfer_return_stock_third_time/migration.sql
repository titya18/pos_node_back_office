-- AlterTable
ALTER TABLE "StockAdjustments" ALTER COLUMN "updatedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "StockRequests" ALTER COLUMN "updatedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "StockReturns" ALTER COLUMN "updatedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "StockTransfers" ALTER COLUMN "updatedAt" DROP NOT NULL;
