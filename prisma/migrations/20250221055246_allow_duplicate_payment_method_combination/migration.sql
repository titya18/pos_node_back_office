/*
  Warnings:

  - The primary key for the `PurchaseOnPayments` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "PurchaseOnPayments" DROP CONSTRAINT "PurchaseOnPayments_pkey",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "PurchaseOnPayments_pkey" PRIMARY KEY ("id");
