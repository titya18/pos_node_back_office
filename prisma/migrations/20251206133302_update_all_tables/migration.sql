-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "Brands" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "deletedBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "Categories" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "deletedBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3),
ADD COLUMN     "updatedBy" INTEGER,
ALTER COLUMN "createdAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Module" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "PaymentMethods" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "ProductVariants" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "deletedBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "Products" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "deletedBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "PurchaseDetails" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "PurchaseOnPayments" ADD COLUMN     "createdBy" INTEGER;

-- AlterTable
ALTER TABLE "Purchases" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "deletedBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "StockMovements" ADD COLUMN     "createdBy" INTEGER;

-- AlterTable
ALTER TABLE "Stocks" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "Suppliers" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "deletedBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "Units" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "deletedBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "deletedBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;

-- AlterTable
ALTER TABLE "VariantAttribute" ADD COLUMN     "createdBy" INTEGER,
ADD COLUMN     "updatedBy" INTEGER;
