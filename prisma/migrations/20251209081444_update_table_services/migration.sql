/*
  Warnings:

  - You are about to alter the column `price` on the `Services` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,4)`.

*/
-- AlterTable
ALTER TABLE "Services" ALTER COLUMN "price" SET DATA TYPE DECIMAL(10,4);
