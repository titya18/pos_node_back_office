/*
  Warnings:

  - Added the required column `productId` to the `SaleReturnItems` table without a default value. This is not possible if the table is not empty.
  - Added the required column `saleItemId` to the `SaleReturnItems` table without a default value. This is not possible if the table is not empty.
  - Added the required column `total` to the `SaleReturnItems` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SaleReturnItems" ADD COLUMN     "discount" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "discountMethod" VARCHAR(15),
ADD COLUMN     "productId" INTEGER NOT NULL,
ADD COLUMN     "saleItemId" INTEGER NOT NULL,
ADD COLUMN     "taxMethod" VARCHAR(15),
ADD COLUMN     "taxNet" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "total" DECIMAL(10,4) NOT NULL;

-- AlterTable
ALTER TABLE "SaleReturns" ADD COLUMN     "discount" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "shipping" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "taxNet" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "taxRate" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "totalAmount" DECIMAL(10,4) DEFAULT 0;
