/*
  Warnings:

  - You are about to drop the column `itermType` on the `OrderItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "OrderItem" DROP COLUMN "itermType",
ADD COLUMN     "ItemType" "ItemType";
