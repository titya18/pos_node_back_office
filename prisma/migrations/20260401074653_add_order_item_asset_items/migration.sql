-- CreateTable
CREATE TABLE "OrderItemAssetItem" (
    "id" SERIAL NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "productAssetItemId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemAssetItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderItemAssetItem_orderItemId_idx" ON "OrderItemAssetItem"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemAssetItem_productAssetItemId_idx" ON "OrderItemAssetItem"("productAssetItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemAssetItem_orderItemId_productAssetItemId_key" ON "OrderItemAssetItem"("orderItemId", "productAssetItemId");

-- AddForeignKey
ALTER TABLE "OrderItemAssetItem" ADD CONSTRAINT "OrderItemAssetItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemAssetItem" ADD CONSTRAINT "OrderItemAssetItem_productAssetItemId_fkey" FOREIGN KEY ("productAssetItemId") REFERENCES "ProductAssetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
