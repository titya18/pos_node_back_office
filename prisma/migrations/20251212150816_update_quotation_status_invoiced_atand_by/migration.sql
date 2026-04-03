-- AlterEnum
ALTER TYPE "QuotationStatus" ADD VALUE 'INVOICED';

-- AlterTable
ALTER TABLE "Quotations" ADD COLUMN     "invoicedAt" TIMESTAMP(3),
ADD COLUMN     "invoicedBy" INTEGER;

-- AddForeignKey
ALTER TABLE "Quotations" ADD CONSTRAINT "Quotations_invoicedBy_fkey" FOREIGN KEY ("invoicedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
