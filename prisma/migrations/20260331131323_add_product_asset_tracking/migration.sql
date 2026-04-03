-- CreateEnum
CREATE TYPE "TrackingType" AS ENUM ('NONE', 'ASSET_ONLY', 'MAC_ONLY', 'ASSET_AND_MAC');

-- CreateEnum
CREATE TYPE "AssetItemStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'TRANSFERRED', 'DAMAGED', 'LOST');

-- AlterTable
ALTER TABLE "ProductVariants" ADD COLUMN     "trackingType" "TrackingType" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "ProductAssetItem" (
    "id" SERIAL NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "assetCode" TEXT,
    "macAddress" TEXT,
    "serialNumber" TEXT,
    "status" "AssetItemStatus" NOT NULL DEFAULT 'IN_STOCK',
    "note" TEXT,
    "sourceType" TEXT,
    "sourceId" INTEGER,
    "soldOrderItemId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" INTEGER,
    "updatedBy" INTEGER,

    CONSTRAINT "ProductAssetItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductAssetItem_productVariantId_branchId_status_idx" ON "ProductAssetItem"("productVariantId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAssetItem_productVariantId_assetCode_key" ON "ProductAssetItem"("productVariantId", "assetCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAssetItem_productVariantId_macAddress_key" ON "ProductAssetItem"("productVariantId", "macAddress");

-- AddForeignKey
ALTER TABLE "ProductAssetItem" ADD CONSTRAINT "ProductAssetItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAssetItem" ADD CONSTRAINT "ProductAssetItem_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
