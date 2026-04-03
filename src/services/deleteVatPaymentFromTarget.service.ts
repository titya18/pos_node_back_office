import { prismaSecondary } from "../lib/prisma";

const SOURCE_SYSTEM = process.env.VAT_SYNC_SOURCE_SYSTEM || "inventory";

export const deleteVatPaymentFromTarget = async (paymentId: number) => {
  const targetPayment = await prismaSecondary.orderOnPayments.findUnique({
    where: {
      sourceSystem_sourcePaymentId: {
        sourceSystem: SOURCE_SYSTEM,
        sourcePaymentId: paymentId,
      },
    },
    select: {
      id: true,
    },
  });

  if (!targetPayment) {
    return null;
  }

  return prismaSecondary.orderOnPayments.delete({
    where: { id: targetPayment.id },
  });
};