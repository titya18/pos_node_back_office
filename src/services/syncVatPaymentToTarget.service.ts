import { prisma, prismaSecondary } from "../lib/prisma";

const SOURCE_SYSTEM = process.env.VAT_SYNC_SOURCE_SYSTEM || "inventory";

export const syncVatPaymentToTarget = async (paymentId: number) => {
  const sourcePayment = await prisma.orderOnPayments.findUnique({
    where: { id: paymentId },
    include: {
      orders: true,
    },
  });

  if (!sourcePayment) {
    throw new Error(`Source payment not found. id=${paymentId}`);
  }

  if (!sourcePayment.orders) {
    throw new Error(`Source payment order not found. paymentId=${paymentId}`);
  }

  if (Number(sourcePayment.orders.vat_status ?? 0) !== 1) {
    return null;
  }

  const targetOrder = await prismaSecondary.order.findUnique({
    where: {
      sourceSystem_sourceOrderId: {
        sourceSystem: SOURCE_SYSTEM,
        sourceOrderId: sourcePayment.orderId,
      },
    },
    select: {
      id: true,
    },
  });

  if (!targetOrder) {
    throw new Error(`Target order not found for source orderId=${sourcePayment.orderId}`);
  }

  const existingPayment = await prismaSecondary.orderOnPayments.findUnique({
    where: {
      sourceSystem_sourcePaymentId: {
        sourceSystem: SOURCE_SYSTEM,
        sourcePaymentId: sourcePayment.id,
      },
    },
    select: {
      id: true,
    },
  });

  if (!existingPayment) {
    return prismaSecondary.orderOnPayments.create({
      data: {
        branchId: sourcePayment.branchId,
        orderId: targetOrder.id,
        paymentDate: sourcePayment.paymentDate,
        paymentMethodId: sourcePayment.paymentMethodId,
        totalPaid: sourcePayment.totalPaid,
        receive_usd: sourcePayment.receive_usd,
        receive_khr: sourcePayment.receive_khr,
        exchangerate: sourcePayment.exchangerate,
        createdAt: sourcePayment.createdAt,
        createdBy: sourcePayment.createdBy,
        updatedAt: sourcePayment.updatedAt ?? new Date(),
        updatedBy: sourcePayment.updatedBy,
        deletedAt: sourcePayment.deletedAt,
        deletedBy: sourcePayment.deletedBy,
        delReason: sourcePayment.delReason,
        status: sourcePayment.status,
        sourceSystem: SOURCE_SYSTEM,
        sourcePaymentId: sourcePayment.id,
      },
    });
  }

  return prismaSecondary.orderOnPayments.update({
    where: { id: existingPayment.id },
    data: {
      branchId: sourcePayment.branchId,
      orderId: targetOrder.id,
      paymentDate: sourcePayment.paymentDate,
      paymentMethodId: sourcePayment.paymentMethodId,
      totalPaid: sourcePayment.totalPaid,
      receive_usd: sourcePayment.receive_usd,
      receive_khr: sourcePayment.receive_khr,
      exchangerate: sourcePayment.exchangerate,
      createdAt: sourcePayment.createdAt,
      createdBy: sourcePayment.createdBy,
      updatedAt: sourcePayment.updatedAt ?? new Date(),
      updatedBy: sourcePayment.updatedBy,
      deletedAt: sourcePayment.deletedAt,
      deletedBy: sourcePayment.deletedBy,
      delReason: sourcePayment.delReason,
      status: sourcePayment.status,
    },
  });
};