-- DropForeignKey
ALTER TABLE "SaleReturnItems" DROP CONSTRAINT "SaleReturnItems_productVariantId_fkey";

-- AlterTable
ALTER TABLE "SaleReturnItems" ADD COLUMN     "ItemType" "ItemType",
ADD COLUMN     "serviceId" INTEGER,
ALTER COLUMN "productVariantId" DROP NOT NULL,
ALTER COLUMN "productId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SaleReturnItems" ADD CONSTRAINT "SaleReturnItems_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItems" ADD CONSTRAINT "SaleReturnItems_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItems" ADD CONSTRAINT "SaleReturnItems_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
