/*
  Warnings:

  - You are about to drop the column `paymentType` on the `OrderOnPayments` table. All the data in the column will be lost.
  - You are about to alter the column `totalPaid` on the `OrderOnPayments` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,4)`.
  - Added the required column `branchId` to the `OrderOnPayments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentMethodId` to the `OrderOnPayments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OrderOnPayments" DROP COLUMN "paymentType",
ADD COLUMN     "branchId" INTEGER NOT NULL,
ADD COLUMN     "paymentMethodId" INTEGER NOT NULL,
ALTER COLUMN "totalPaid" SET DATA TYPE DECIMAL(10,4);

-- AddForeignKey
ALTER TABLE "OrderOnPayments" ADD CONSTRAINT "OrderOnPayments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
