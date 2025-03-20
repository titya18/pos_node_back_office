-- CreateTable
CREATE TABLE "Products" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "brandId" INTEGER NOT NULL,
    "unitId" INTEGER NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "cost" DECIMAL(10,4) NOT NULL,
    "price" DECIMAL(10,4) NOT NULL,
    "image" VARCHAR(200),
    "stockAlert" SMALLINT DEFAULT 0,
    "note" VARCHAR(250),
    "isActive" SMALLINT DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Products_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Products" ADD CONSTRAINT "Products_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
