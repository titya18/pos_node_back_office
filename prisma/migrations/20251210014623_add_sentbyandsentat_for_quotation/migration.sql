-- AlterTable
ALTER TABLE "Quotations" ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentBy" INTEGER;

-- AddForeignKey
ALTER TABLE "Quotations" ADD CONSTRAINT "Quotations_sentBy_fkey" FOREIGN KEY ("sentBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
