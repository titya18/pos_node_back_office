/*
  Warnings:

  - A unique constraint covering the columns `[serviceCode]` on the table `Services` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `serviceCode` to the `Services` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Services" ADD COLUMN     "serviceCode" VARCHAR(50) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Services_serviceCode_key" ON "Services"("serviceCode");
