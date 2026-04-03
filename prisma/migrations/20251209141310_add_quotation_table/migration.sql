-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('PENDING', 'SENT');

-- CreateTable
CREATE TABLE "Quotations" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "ref" VARCHAR(50) NOT NULL,
    "quotationDate" DATE NOT NULL,
    "taxRate" DECIMAL(10,4) DEFAULT 0,
    "taxNet" DECIMAL(10,4) DEFAULT 0,
    "discount" DECIMAL(10,4) DEFAULT 0,
    "shipping" DECIMAL(10,4) DEFAULT 0,
    "grandTotal" DECIMAL(10,4) NOT NULL,
    "status" "QuotationStatus" NOT NULL,
    "note" VARCHAR(500),
    "deletedAt" TIMESTAMP(3),
    "deletedBy" INTEGER,
    "createdBy" INTEGER,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationDetails" (
    "id" SERIAL NOT NULL,
    "quotationId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "productVariantId" INTEGER NOT NULL,
    "cost" DECIMAL(10,4) NOT NULL,
    "taxNet" DECIMAL(10,4) DEFAULT 0,
    "taxMethod" VARCHAR(15),
    "discount" DECIMAL(10,4) DEFAULT 0,
    "discountMethod" VARCHAR(15),
    "total" DECIMAL(10,4) NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "QuotationDetails_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Quotations" ADD CONSTRAINT "Quotations_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotations" ADD CONSTRAINT "Quotations_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotations" ADD CONSTRAINT "Quotations_deletedBy_fkey" FOREIGN KEY ("deletedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotations" ADD CONSTRAINT "Quotations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotations" ADD CONSTRAINT "Quotations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDetails" ADD CONSTRAINT "QuotationDetails_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDetails" ADD CONSTRAINT "QuotationDetails_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationDetails" ADD CONSTRAINT "QuotationDetails_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
