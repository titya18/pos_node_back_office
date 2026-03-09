-- AlterTable
ALTER TABLE "AdjustmentDetails" ADD COLUMN     "baseQty" DECIMAL(10,4),
ADD COLUMN     "unitId" INTEGER,
ADD COLUMN     "unitQty" DECIMAL(10,4),
ALTER COLUMN "quantity" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "baseQty" DECIMAL(10,4),
ADD COLUMN     "cogs" DECIMAL(12,4),
ADD COLUMN     "unitId" INTEGER,
ADD COLUMN     "unitQty" DECIMAL(10,4),
ALTER COLUMN "quantity" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProductVariants" ADD COLUMN     "baseUnitId" INTEGER;

-- AlterTable
ALTER TABLE "PurchaseDetails" ADD COLUMN     "baseQty" DECIMAL(10,4),
ADD COLUMN     "unitId" INTEGER,
ADD COLUMN     "unitQty" DECIMAL(10,4),
ALTER COLUMN "quantity" DROP NOT NULL;

-- AlterTable
ALTER TABLE "QuotationDetails" ADD COLUMN     "baseQty" DECIMAL(10,4),
ADD COLUMN     "unitId" INTEGER,
ADD COLUMN     "unitQty" DECIMAL(10,4),
ALTER COLUMN "quantity" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RequestDetails" ADD COLUMN     "baseQty" DECIMAL(10,4),
ADD COLUMN     "unitId" INTEGER,
ADD COLUMN     "unitQty" DECIMAL(10,4),
ALTER COLUMN "quantity" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ReturnDetails" ADD COLUMN     "baseQty" DECIMAL(10,4),
ADD COLUMN     "unitId" INTEGER,
ADD COLUMN     "unitQty" DECIMAL(10,4),
ALTER COLUMN "quantity" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SaleReturnItems" ADD COLUMN     "baseQty" DECIMAL(10,4),
ADD COLUMN     "unitId" INTEGER,
ADD COLUMN     "unitQty" DECIMAL(10,4),
ALTER COLUMN "quantity" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TransferDetails" ADD COLUMN     "baseQty" DECIMAL(10,4),
ADD COLUMN     "unitId" INTEGER,
ADD COLUMN     "unitQty" DECIMAL(10,4),
ALTER COLUMN "quantity" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ProductUnitConversion" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "fromUnitId" INTEGER NOT NULL,
    "toUnitId" INTEGER NOT NULL,
    "multiplier" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "ProductUnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductUnitConversion_productId_idx" ON "ProductUnitConversion"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnitConversion_productId_fromUnitId_toUnitId_key" ON "ProductUnitConversion"("productId", "fromUnitId", "toUnitId");

-- CreateIndex
CREATE INDEX "StockMovements_productVariantId_branchId_createdAt_idx" ON "StockMovements"("productVariantId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovements_productVariantId_branchId_remainingQty_idx" ON "StockMovements"("productVariantId", "branchId", "remainingQty");

-- CreateIndex
CREATE INDEX "StockMovements_sourceMovementId_idx" ON "StockMovements"("sourceMovementId");

-- CreateIndex
CREATE INDEX "StockMovements_purchaseDetailId_idx" ON "StockMovements"("purchaseDetailId");

-- CreateIndex
CREATE INDEX "StockMovements_orderItemId_idx" ON "StockMovements"("orderItemId");

-- CreateIndex
CREATE INDEX "StockMovements_transferDetailId_idx" ON "StockMovements"("transferDetailId");

-- CreateIndex
CREATE INDEX "StockMovements_adjustmentDetailId_idx" ON "StockMovements"("adjustmentDetailId");

-- CreateIndex
CREATE INDEX "StockMovements_requestDetailId_idx" ON "StockMovements"("requestDetailId");

-- CreateIndex
CREATE INDEX "StockMovements_returnDetailId_idx" ON "StockMovements"("returnDetailId");

-- CreateIndex
CREATE INDEX "StockMovements_saleReturnItemId_idx" ON "StockMovements"("saleReturnItemId");

-- AddForeignKey
ALTER TABLE "ProductUnitConversion" ADD CONSTRAINT "ProductUnitConversion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUnitConversion" ADD CONSTRAINT "ProductUnitConversion_fromUnitId_fkey" FOREIGN KEY ("fromUnitId") REFERENCES "Units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUnitConversion" ADD CONSTRAINT "ProductUnitConversion_toUnitId_fkey" FOREIGN KEY ("toUnitId") REFERENCES "Units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariants" ADD CONSTRAINT "ProductVariants_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDetails" ADD CONSTRAINT "PurchaseDetails_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDetails" ADD CONSTRAINT "QuotationDetails_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentDetails" ADD CONSTRAINT "AdjustmentDetails_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferDetails" ADD CONSTRAINT "TransferDetails_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDetails" ADD CONSTRAINT "RequestDetails_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnDetails" ADD CONSTRAINT "ReturnDetails_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItems" ADD CONSTRAINT "SaleReturnItems_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
