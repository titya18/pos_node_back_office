/*
  Warnings:

  - Added the required column `ref` to the `Expenses` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ref` to the `Incomes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ref` to the `StockAdjustments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ref` to the `StockRequests` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ref` to the `StockReturns` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ref` to the `StockTransfers` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Expenses" ADD COLUMN     "ref" VARCHAR(50) NOT NULL;

-- AlterTable
ALTER TABLE "Incomes" ADD COLUMN     "ref" VARCHAR(50) NOT NULL;

-- AlterTable
ALTER TABLE "StockAdjustments" ADD COLUMN     "ref" VARCHAR(50) NOT NULL;

-- AlterTable
ALTER TABLE "StockRequests" ADD COLUMN     "ref" VARCHAR(50) NOT NULL;

-- AlterTable
ALTER TABLE "StockReturns" ADD COLUMN     "ref" VARCHAR(50) NOT NULL;

-- AlterTable
ALTER TABLE "StockTransfers" ADD COLUMN     "ref" VARCHAR(50) NOT NULL;
