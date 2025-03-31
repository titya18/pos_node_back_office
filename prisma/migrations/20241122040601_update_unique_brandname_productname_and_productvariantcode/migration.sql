/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Brands` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code]` on the table `ProductVariants` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name]` on the table `Products` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Brands_name_key" ON "Brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariants_code_key" ON "ProductVariants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Products_name_key" ON "Products"("name");
