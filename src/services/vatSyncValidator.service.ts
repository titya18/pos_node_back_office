import { prismaSecondary } from "../lib/prisma";

export const validateTargetReferencesForOrderSync = async (sourceOrder: any) => {
  const branch = await prismaSecondary.branch.findUnique({
    where: { id: sourceOrder.branchId },
    select: { id: true },
  });

  if (!branch) {
    throw new Error(`Target DB missing Branch id=${sourceOrder.branchId}`);
  }

  if (sourceOrder.customerId) {
    const customer = await prismaSecondary.customer.findUnique({
      where: { id: sourceOrder.customerId },
      select: { id: true },
    });

    if (!customer) {
      throw new Error(`Target DB missing Customer id=${sourceOrder.customerId}`);
    }
  }

  for (const item of sourceOrder.items ?? []) {
    if (item.productId) {
      const product = await prismaSecondary.products.findUnique({
        where: { id: item.productId },
        select: { id: true },
      });

      if (!product) {
        throw new Error(`Target DB missing Product id=${item.productId}`);
      }
    }

    if (item.productVariantId) {
      const variant = await prismaSecondary.productVariants.findUnique({
        where: { id: item.productVariantId },
        select: { id: true },
      });

      if (!variant) {
        throw new Error(`Target DB missing ProductVariant id=${item.productVariantId}`);
      }
    }

    if (item.serviceId) {
      const service = await prismaSecondary.services.findUnique({
        where: { id: item.serviceId },
        select: { id: true },
      });

      if (!service) {
        throw new Error(`Target DB missing Service id=${item.serviceId}`);
      }
    }

    if (item.unitId) {
      const unit = await prismaSecondary.units.findUnique({
        where: { id: item.unitId },
        select: { id: true },
      });

      if (!unit) {
        throw new Error(`Target DB missing Unit id=${item.unitId}`);
      }
    }
  }

  for (const payment of sourceOrder.orderOnPayments ?? []) {
    const paymentMethod = await prismaSecondary.paymentMethods.findUnique({
      where: { id: payment.paymentMethodId },
      select: { id: true },
    });

    if (!paymentMethod) {
      throw new Error(`Target DB missing PaymentMethod id=${payment.paymentMethodId}`);
    }
  }
};