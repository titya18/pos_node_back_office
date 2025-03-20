/*
  Warnings:

  - You are about to drop the column `code` on the `Products` table. All the data in the column will be lost.
  - You are about to drop the column `cost` on the `Products` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `Products` table. All the data in the column will be lost.
  - You are about to drop the column `unitId` on the `Products` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Products" DROP CONSTRAINT "Products_unitId_fkey";

-- AlterTable
ALTER TABLE "Products" DROP COLUMN "code",
DROP COLUMN "cost",
DROP COLUMN "price",
DROP COLUMN "unitId",
ALTER COLUMN "name" SET DATA TYPE VARCHAR(200);

-- CreateTable
CREATE TABLE "ProductVariants" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "unitId" INTEGER,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "image" VARCHAR(200)[],
    "qty" INTEGER,
    "retailPrice" DECIMAL(10,4) NOT NULL,
    "wholeSalePrice" DECIMAL(10,4) NOT NULL,
    "isActive" SMALLINT DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductVariants_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProductVariants" ADD CONSTRAINT "ProductVariants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariants" ADD CONSTRAINT "ProductVariants_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
