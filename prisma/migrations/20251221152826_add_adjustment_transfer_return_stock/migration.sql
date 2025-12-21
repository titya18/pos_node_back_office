-- CreateEnum
CREATE TYPE "StatusType" AS ENUM ('PENDING', 'APPROVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StockAdjustments" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "StatusType" "StatusType",
    "note" VARCHAR(500),
    "delReason" VARCHAR(1000),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" INTEGER,
    "createdBy" INTEGER,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" INTEGER,

    CONSTRAINT "StockAdjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdjustmentDetails" (
    "id" SERIAL NOT NULL,
    "adjustmentId" INTEGER NOT NULL,
    "productId" INTEGER,
    "productVariantId" INTEGER,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "AdjustmentDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfers" (
    "id" SERIAL NOT NULL,
    "fromBranchId" INTEGER NOT NULL,
    "toBranchId" INTEGER NOT NULL,
    "StatusType" "StatusType",
    "note" VARCHAR(500),
    "delReason" VARCHAR(1000),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" INTEGER,
    "createdBy" INTEGER,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" INTEGER,

    CONSTRAINT "StockTransfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferDetails" (
    "id" SERIAL NOT NULL,
    "transferId" INTEGER NOT NULL,
    "productId" INTEGER,
    "productVariantId" INTEGER,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "TransferDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRequests" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "requestBy" INTEGER NOT NULL,
    "StatusType" "StatusType",
    "note" VARCHAR(500),
    "delReason" VARCHAR(1000),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" INTEGER,
    "createdBy" INTEGER,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" INTEGER,

    CONSTRAINT "StockRequests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestDetails" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "productId" INTEGER,
    "productVariantId" INTEGER,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "RequestDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReturns" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "returnBy" INTEGER NOT NULL,
    "StatusType" "StatusType",
    "note" VARCHAR(500),
    "delReason" VARCHAR(1000),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" INTEGER,
    "createdBy" INTEGER,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" INTEGER,

    CONSTRAINT "StockReturns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnDetails" (
    "id" SERIAL NOT NULL,
    "returnId" INTEGER NOT NULL,
    "productId" INTEGER,
    "productVariantId" INTEGER,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ReturnDetails_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StockAdjustments" ADD CONSTRAINT "StockAdjustments_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustments" ADD CONSTRAINT "StockAdjustments_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustments" ADD CONSTRAINT "StockAdjustments_deletedBy_fkey" FOREIGN KEY ("deletedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustments" ADD CONSTRAINT "StockAdjustments_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustments" ADD CONSTRAINT "StockAdjustments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentDetails" ADD CONSTRAINT "AdjustmentDetails_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "StockAdjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentDetails" ADD CONSTRAINT "AdjustmentDetails_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdjustmentDetails" ADD CONSTRAINT "AdjustmentDetails_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfers" ADD CONSTRAINT "StockTransfers_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfers" ADD CONSTRAINT "StockTransfers_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfers" ADD CONSTRAINT "StockTransfers_deletedBy_fkey" FOREIGN KEY ("deletedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfers" ADD CONSTRAINT "StockTransfers_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfers" ADD CONSTRAINT "StockTransfers_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfers" ADD CONSTRAINT "StockTransfers_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferDetails" ADD CONSTRAINT "TransferDetails_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferDetails" ADD CONSTRAINT "TransferDetails_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferDetails" ADD CONSTRAINT "TransferDetails_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequests" ADD CONSTRAINT "StockRequests_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequests" ADD CONSTRAINT "StockRequests_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequests" ADD CONSTRAINT "StockRequests_deletedBy_fkey" FOREIGN KEY ("deletedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequests" ADD CONSTRAINT "StockRequests_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequests" ADD CONSTRAINT "StockRequests_requestBy_fkey" FOREIGN KEY ("requestBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequests" ADD CONSTRAINT "StockRequests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDetails" ADD CONSTRAINT "RequestDetails_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "StockRequests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDetails" ADD CONSTRAINT "RequestDetails_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDetails" ADD CONSTRAINT "RequestDetails_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReturns" ADD CONSTRAINT "StockReturns_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReturns" ADD CONSTRAINT "StockReturns_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReturns" ADD CONSTRAINT "StockReturns_deletedBy_fkey" FOREIGN KEY ("deletedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReturns" ADD CONSTRAINT "StockReturns_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReturns" ADD CONSTRAINT "StockReturns_returnBy_fkey" FOREIGN KEY ("returnBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReturns" ADD CONSTRAINT "StockReturns_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnDetails" ADD CONSTRAINT "ReturnDetails_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "StockReturns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnDetails" ADD CONSTRAINT "ReturnDetails_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnDetails" ADD CONSTRAINT "ReturnDetails_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
