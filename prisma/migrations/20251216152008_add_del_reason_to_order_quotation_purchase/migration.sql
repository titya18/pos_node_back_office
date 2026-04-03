-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "delReason" VARCHAR(1000);

-- AlterTable
ALTER TABLE "Purchases" ADD COLUMN     "delReason" VARCHAR(1000);

-- AlterTable
ALTER TABLE "Quotations" ADD COLUMN     "delReason" VARCHAR(1000);
