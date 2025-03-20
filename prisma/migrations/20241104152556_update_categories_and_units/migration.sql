-- AlterTable
ALTER TABLE "Categories" ADD COLUMN     "branchId" INTEGER;

-- AlterTable
ALTER TABLE "Units" ADD COLUMN     "branchId" INTEGER;

-- AddForeignKey
ALTER TABLE "Categories" ADD CONSTRAINT "Categories_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Units" ADD CONSTRAINT "Units_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
