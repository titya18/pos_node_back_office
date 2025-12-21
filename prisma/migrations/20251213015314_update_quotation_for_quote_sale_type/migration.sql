-- CreateEnum
CREATE TYPE "QuoteType" AS ENUM ('RETAIL', 'WHOLESALE');

-- AlterTable
ALTER TABLE "Quotations" ADD COLUMN     "QuoteType" "QuoteType";
