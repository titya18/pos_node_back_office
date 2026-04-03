-- AlterTable
ALTER TABLE "StockMovements" ADD COLUMN     "adjustmentDetailId" INTEGER,
ADD COLUMN     "orderItemId" INTEGER,
ADD COLUMN     "purchaseDetailId" INTEGER,
ADD COLUMN     "requestDetailId" INTEGER,
ADD COLUMN     "returnDetailId" INTEGER,
ADD COLUMN     "saleReturnItemId" INTEGER,
ADD COLUMN     "transferDetailId" INTEGER;

-- CreateTable
CREATE TABLE "SaleReturns" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "status" "StatusType" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMP(3),
    "updatedBy" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" INTEGER,

    CONSTRAINT "SaleReturns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturnItems" (
    "id" SERIAL NOT NULL,
    "saleReturnId" INTEGER NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "SaleReturnItems_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StockMovements" ADD CONSTRAINT "StockMovements_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovements" ADD CONSTRAINT "StockMovements_purchaseDetailId_fkey" FOREIGN KEY ("purchaseDetailId") REFERENCES "PurchaseDetails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovements" ADD CONSTRAINT "StockMovements_adjustmentDetailId_fkey" FOREIGN KEY ("adjustmentDetailId") REFERENCES "AdjustmentDetails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovements" ADD CONSTRAINT "StockMovements_transferDetailId_fkey" FOREIGN KEY ("transferDetailId") REFERENCES "TransferDetails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovements" ADD CONSTRAINT "StockMovements_requestDetailId_fkey" FOREIGN KEY ("requestDetailId") REFERENCES "RequestDetails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovements" ADD CONSTRAINT "StockMovements_returnDetailId_fkey" FOREIGN KEY ("returnDetailId") REFERENCES "ReturnDetails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovements" ADD CONSTRAINT "StockMovements_saleReturnItemId_fkey" FOREIGN KEY ("saleReturnItemId") REFERENCES "SaleReturnItems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturns" ADD CONSTRAINT "SaleReturns_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturns" ADD CONSTRAINT "SaleReturns_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturns" ADD CONSTRAINT "SaleReturns_deletedBy_fkey" FOREIGN KEY ("deletedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturns" ADD CONSTRAINT "SaleReturns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItems" ADD CONSTRAINT "SaleReturnItems_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnItems" ADD CONSTRAINT "SaleReturnItems_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
