-- DropForeignKey
ALTER TABLE "Products" DROP CONSTRAINT "Products_brandId_fkey";

-- DropForeignKey
ALTER TABLE "Products" DROP CONSTRAINT "Products_unitId_fkey";

-- AlterTable
ALTER TABLE "Products" ALTER COLUMN "brandId" DROP NOT NULL,
ALTER COLUMN "unitId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
