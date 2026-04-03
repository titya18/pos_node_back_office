/*
  Warnings:

  - You are about to drop the column `attributeId` on the `VariantValue` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `VariantAttribute` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `variantAttributeId` to the `VariantValue` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "VariantValue" DROP CONSTRAINT "VariantValue_attributeId_fkey";

-- AlterTable
ALTER TABLE "VariantValue" DROP COLUMN "attributeId",
ADD COLUMN     "variantAttributeId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "VariantAttribute_name_key" ON "VariantAttribute"("name");

-- AddForeignKey
ALTER TABLE "VariantValue" ADD CONSTRAINT "VariantValue_variantAttributeId_fkey" FOREIGN KEY ("variantAttributeId") REFERENCES "VariantAttribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
