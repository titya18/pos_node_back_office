/*
  Warnings:

  - You are about to drop the column `name` on the `Permission` table. All the data in the column will be lost.
  - You are about to drop the column `module` on the `Role` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[moduel]` on the table `Permission` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `moduel` to the `Permission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `permissionNames` to the `Permission` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Permission_name_key";

-- AlterTable
ALTER TABLE "Permission" DROP COLUMN "name",
ADD COLUMN     "moduel" TEXT NOT NULL,
ADD COLUMN     "permissionNames" VARCHAR(80) NOT NULL;

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "module";

-- CreateIndex
CREATE UNIQUE INDEX "Permission_moduel_key" ON "Permission"("moduel");
