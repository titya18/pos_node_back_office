/*
  Warnings:

  - Added the required column `branchId` to the `StockTransfers` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "StockAdjustments" ADD COLUMN     "AdjustMentType" "AdjustMentType";

-- AlterTable
ALTER TABLE "StockTransfers" ADD COLUMN     "branchId" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "StockTransfers" ADD CONSTRAINT "StockTransfers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
