/*
  Warnings:

  - You are about to drop the column `code` on the `PurchaseDetails` table. All the data in the column will be lost.
  - Changed the type of `purchaseDate` on the `Purchases` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterEnum
ALTER TYPE "PurchaseStatus" ADD VALUE 'RECEIVED';

-- AlterTable
ALTER TABLE "PurchaseDetails" DROP COLUMN "code";

-- AlterTable
ALTER TABLE "Purchases" DROP COLUMN "purchaseDate",
ADD COLUMN     "purchaseDate" DATE NOT NULL;
