/*
  Warnings:

  - You are about to alter the column `price` on the `OrderItem` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,4)`.
  - Added the required column `total` to the `OrderItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "discount" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "shipping" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "taxNet" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "taxRate" DECIMAL(10,4) DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "discount" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "discountMethod" VARCHAR(15),
ADD COLUMN     "productId" INTEGER,
ADD COLUMN     "taxMethod" VARCHAR(15),
ADD COLUMN     "taxNet" DECIMAL(10,4) DEFAULT 0,
ADD COLUMN     "total" DECIMAL(10,4) NOT NULL,
ALTER COLUMN "price" SET DATA TYPE DECIMAL(10,4);
