/*
  Warnings:

  - Added the required column `branchId` to the `SaleReturns` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SaleReturns" ADD COLUMN     "branchId" INTEGER NOT NULL;
