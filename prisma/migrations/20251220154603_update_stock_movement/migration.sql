/*
  Warnings:

  - The values [STOCK_IN,STOCK_OUT] on the enum `MovementType` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "AdjustMentType" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "MoveStatusType" AS ENUM ('PENDING', 'APPROVED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "MovementType_new" AS ENUM ('RETURN', 'ADJUSTMENT', 'TRANSFER');
ALTER TABLE "StockMovements" ALTER COLUMN "type" TYPE "MovementType_new" USING ("type"::text::"MovementType_new");
ALTER TYPE "MovementType" RENAME TO "MovementType_old";
ALTER TYPE "MovementType_new" RENAME TO "MovementType";
DROP TYPE "MovementType_old";
COMMIT;

-- AlterTable
ALTER TABLE "StockMovements" ADD COLUMN     "AdjustMentType" "AdjustMentType",
ADD COLUMN     "status" "MoveStatusType";
