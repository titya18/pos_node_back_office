/*
  Warnings:

  - You are about to drop the `_VariantOnProductVariant` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[productVariantId,branchId]` on the table `Stocks` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UnitType" ADD VALUE 'VOLUME';
ALTER TYPE "UnitType" ADD VALUE 'AREA';
ALTER TYPE "UnitType" ADD VALUE 'CAPACITY';

-- DropForeignKey
ALTER TABLE "_VariantOnProductVariant" DROP CONSTRAINT "_VariantOnProductVariant_A_fkey";

-- DropForeignKey
ALTER TABLE "_VariantOnProductVariant" DROP CONSTRAINT "_VariantOnProductVariant_B_fkey";

-- DropTable
DROP TABLE "_VariantOnProductVariant";

-- CreateTable
CREATE TABLE "ProductVariantValues" (
    "id" SERIAL NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "variantValueId" INTEGER NOT NULL,

    CONSTRAINT "ProductVariantValues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProductVariantsToVariantValue" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariantValues_productVariantId_variantValueId_key" ON "ProductVariantValues"("productVariantId", "variantValueId");

-- CreateIndex
CREATE UNIQUE INDEX "_ProductVariantsToVariantValue_AB_unique" ON "_ProductVariantsToVariantValue"("A", "B");

-- CreateIndex
CREATE INDEX "_ProductVariantsToVariantValue_B_index" ON "_ProductVariantsToVariantValue"("B");

-- CreateIndex
CREATE INDEX "ProductVariants_productId_idx" ON "ProductVariants"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Stocks_productVariantId_branchId_key" ON "Stocks"("productVariantId", "branchId");

-- AddForeignKey
ALTER TABLE "ProductVariantValues" ADD CONSTRAINT "ProductVariantValues_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariantValues" ADD CONSTRAINT "ProductVariantValues_variantValueId_fkey" FOREIGN KEY ("variantValueId") REFERENCES "VariantValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductVariantsToVariantValue" ADD CONSTRAINT "_ProductVariantsToVariantValue_A_fkey" FOREIGN KEY ("A") REFERENCES "ProductVariants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductVariantsToVariantValue" ADD CONSTRAINT "_ProductVariantsToVariantValue_B_fkey" FOREIGN KEY ("B") REFERENCES "VariantValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
