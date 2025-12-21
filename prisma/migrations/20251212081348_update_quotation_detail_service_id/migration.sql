-- DropForeignKey
ALTER TABLE "QuotationDetails" DROP CONSTRAINT "QuotationDetails_productId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationDetails" DROP CONSTRAINT "QuotationDetails_productVariantId_fkey";

-- AlterTable
ALTER TABLE "QuotationDetails" ADD COLUMN     "serviceId" INTEGER,
ALTER COLUMN "productId" DROP NOT NULL,
ALTER COLUMN "productVariantId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "QuotationDetails" ADD CONSTRAINT "QuotationDetails_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDetails" ADD CONSTRAINT "QuotationDetails_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDetails" ADD CONSTRAINT "QuotationDetails_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
