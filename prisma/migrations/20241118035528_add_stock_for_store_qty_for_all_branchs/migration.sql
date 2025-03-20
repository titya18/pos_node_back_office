/*
  Warnings:

  - You are about to drop the column `qty` on the `ProductVariants` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ProductVariants" DROP COLUMN "qty";

-- CreateTable
CREATE TABLE "Stocks" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "qty" INTEGER,

    CONSTRAINT "Stocks_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Stocks" ADD CONSTRAINT "Stocks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stocks" ADD CONSTRAINT "Stocks_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
