-- AddForeignKey
ALTER TABLE "ProductVariants" ADD CONSTRAINT "ProductVariants_retailPriceUnitId_fkey" FOREIGN KEY ("retailPriceUnitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariants" ADD CONSTRAINT "ProductVariants_wholeSalePriceUnitId_fkey" FOREIGN KEY ("wholeSalePriceUnitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
