-- AlterTable
ALTER TABLE "ProductVariants" ADD COLUMN     "purchasePrice" DECIMAL(10,4) NOT NULL DEFAULT 0.0000;

-- CreateTable
CREATE TABLE "PaymentMethods" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOnPayments" (
    "branchId" INTEGER NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "paymentMethodId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" DECIMAL(10,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOnPayments_pkey" PRIMARY KEY ("paymentMethodId","purchaseId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethods_name_key" ON "PaymentMethods"("name");

-- AddForeignKey
ALTER TABLE "PurchaseOnPayments" ADD CONSTRAINT "PurchaseOnPayments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOnPayments" ADD CONSTRAINT "PurchaseOnPayments_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
