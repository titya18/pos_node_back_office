/*
  Warnings:

  - You are about to drop the column `stockAlert` on the `Products` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Brands" ALTER COLUMN "kh_name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProductVariants" ADD COLUMN     "stockAlert" SMALLINT DEFAULT 0;

-- AlterTable
ALTER TABLE "Products" DROP COLUMN "stockAlert";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3);
