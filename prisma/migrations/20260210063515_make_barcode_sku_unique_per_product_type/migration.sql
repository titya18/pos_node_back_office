/*
  Warnings:

  - A unique constraint covering the columns `[productType,sku]` on the table `ProductVariants` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[productType,barcode]` on the table `ProductVariants` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "ProductVariants_productType_sku_key" ON "ProductVariants"("productType", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariants_productType_barcode_key" ON "ProductVariants"("productType", "barcode");
