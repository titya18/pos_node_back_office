-- AlterTable
ALTER TABLE "ProductVariants" ADD COLUMN     "purchasePriceUnitId" INTEGER;

-- AddForeignKey
ALTER TABLE "ProductVariants" ADD CONSTRAINT "ProductVariants_purchasePriceUnitId_fkey" FOREIGN KEY ("purchasePriceUnitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
