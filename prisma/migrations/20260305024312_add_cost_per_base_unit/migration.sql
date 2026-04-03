-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "costPerBaseUnit" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "PurchaseDetails" ADD COLUMN     "costPerBaseUnit" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "QuotationDetails" ADD COLUMN     "costPerBaseUnit" DECIMAL(10,4);
