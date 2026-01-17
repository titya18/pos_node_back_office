-- AlterTable
ALTER TABLE "OrderOnPayments" ADD COLUMN     "exchangerate" INTEGER,
ADD COLUMN     "receive_khr" INTEGER,
ADD COLUMN     "receive_usd" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "PurchaseOnPayments" ADD COLUMN     "exchangerate" INTEGER,
ADD COLUMN     "receive_khr" INTEGER,
ADD COLUMN     "receive_usd" DECIMAL(10,4);
