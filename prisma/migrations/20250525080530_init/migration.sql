/*
  Warnings:

  - You are about to drop the column `name` on the `Brands` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[en_name]` on the table `Brands` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[kh_name]` on the table `Brands` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `en_name` to the `Brands` table without a default value. This is not possible if the table is not empty.
  - Added the required column `kh_name` to the `Brands` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Brands_name_key";

-- AlterTable
ALTER TABLE "Brands" DROP COLUMN "name",
ADD COLUMN     "en_name" VARCHAR(100) NOT NULL,
ADD COLUMN     "kh_name" VARCHAR(100) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Brands_en_name_key" ON "Brands"("en_name");

-- CreateIndex
CREATE UNIQUE INDEX "Brands_kh_name_key" ON "Brands"("kh_name");
