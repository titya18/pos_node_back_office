-- AlterTable
ALTER TABLE "VariantAttribute" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" INTEGER;
