-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "declared_at" TIMESTAMP(3),
ADD COLUMN     "declared_by" INTEGER;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_declared_by_fkey" FOREIGN KEY ("declared_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
