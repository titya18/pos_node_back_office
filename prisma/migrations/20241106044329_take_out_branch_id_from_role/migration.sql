/*
  Warnings:

  - You are about to drop the column `branchId` on the `Role` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `Role` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Role_name_branchId_key";

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "branchId";

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
