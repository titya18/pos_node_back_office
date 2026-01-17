-- CreateTable
CREATE TABLE "PurchaseAmountAuthorize" (
    "id" SERIAL NOT NULL,
    "amount" DECIMAL(10,4) NOT NULL,
    "description" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMP(3),
    "updatedBy" INTEGER,

    CONSTRAINT "PurchaseAmountAuthorize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRates" (
    "id" SERIAL NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" INTEGER,
    "updatedAt" TIMESTAMP(3),
    "updatedBy" INTEGER,

    CONSTRAINT "ExchangeRates_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PurchaseAmountAuthorize" ADD CONSTRAINT "PurchaseAmountAuthorize_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseAmountAuthorize" ADD CONSTRAINT "PurchaseAmountAuthorize_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRates" ADD CONSTRAINT "ExchangeRates_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRates" ADD CONSTRAINT "ExchangeRates_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
