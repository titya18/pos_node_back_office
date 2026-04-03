/*
  Warnings:

  - A unique constraint covering the columns `[productVariantId,serialNumber]` on the table `ProductAssetItem` will be added. If there are existing duplicate values, this will fail.
  - Made the column `serialNumber` on table `ProductAssetItem` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "ProductAssetItem" ALTER COLUMN "serialNumber" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ProductAssetItem_productVariantId_serialNumber_key" ON "ProductAssetItem"("productVariantId", "serialNumber");
