/*
  Warnings:

  - You are about to drop the column `QuoteType` on the `Quotations` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "QuoteSaleType" AS ENUM ('RETAIL', 'WHOLESALE');

-- AlterTable
ALTER TABLE "Quotations" DROP COLUMN "QuoteType",
ADD COLUMN     "QuoteSaleType" "QuoteSaleType";

-- DropEnum
DROP TYPE "QuoteType";
