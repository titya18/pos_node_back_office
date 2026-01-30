-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'SALE_RETURN';

-- AlterTable
ALTER TABLE "SaleReturns" ADD COLUMN     "customerId" INTEGER;

-- AddForeignKey
ALTER TABLE "SaleReturns" ADD CONSTRAINT "SaleReturns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
