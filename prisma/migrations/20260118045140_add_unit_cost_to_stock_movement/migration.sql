-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'PURCHASE';

-- AlterTable
ALTER TABLE "StockMovements" ADD COLUMN     "unitCost" DECIMAL(10,4);
