-- AlterTable
ALTER TABLE "Purchases" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedBy" INTEGER;

-- AddForeignKey
ALTER TABLE "Purchases" ADD CONSTRAINT "Purchases_receivedBy_fkey" FOREIGN KEY ("receivedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
