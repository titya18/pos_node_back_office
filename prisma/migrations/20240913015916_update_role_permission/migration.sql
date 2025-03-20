/*
  Warnings:

  - You are about to drop the column `moduel` on the `Permission` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[module]` on the table `Permission` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `module` to the `Permission` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Permission_moduel_key";

-- AlterTable
ALTER TABLE "Permission" DROP COLUMN "moduel",
ADD COLUMN     "module" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Permission_module_key" ON "Permission"("module");
