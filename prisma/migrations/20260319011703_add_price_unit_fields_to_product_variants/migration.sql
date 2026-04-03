-- AlterTable
ALTER TABLE "ProductVariants" ADD COLUMN     "retailPriceUnitId" INTEGER,
ADD COLUMN     "wholeSalePriceUnitId" INTEGER,
ALTER COLUMN "retailPrice" DROP NOT NULL,
ALTER COLUMN "retailPrice" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "wholeSalePrice" DROP NOT NULL,
ALTER COLUMN "wholeSalePrice" SET DATA TYPE DECIMAL(18,4);
