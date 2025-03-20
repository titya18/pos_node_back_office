/*
  Warnings:

  - You are about to drop the column `branchId` on the `Categories` table. All the data in the column will be lost.
  - You are about to drop the column `branchId` on the `Units` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Categories" DROP CONSTRAINT "Categories_branchId_fkey";

-- DropForeignKey
ALTER TABLE "Units" DROP CONSTRAINT "Units_branchId_fkey";

-- AlterTable
ALTER TABLE "Categories" DROP COLUMN "branchId";

-- AlterTable
ALTER TABLE "Units" DROP COLUMN "branchId";
