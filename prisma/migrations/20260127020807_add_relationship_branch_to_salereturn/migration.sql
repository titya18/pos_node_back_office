-- AddForeignKey
ALTER TABLE "SaleReturns" ADD CONSTRAINT "SaleReturns_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
