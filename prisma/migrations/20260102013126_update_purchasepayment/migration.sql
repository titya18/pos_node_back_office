-- AddForeignKey
ALTER TABLE "PurchaseOnPayments" ADD CONSTRAINT "PurchaseOnPayments_deletedBy_fkey" FOREIGN KEY ("deletedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
