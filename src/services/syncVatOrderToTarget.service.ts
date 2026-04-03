import { prisma, prismaSecondary } from "../lib/prisma";
import { getNextTargetOrderRef } from "./targetOrderRef.service";
import { validateTargetReferencesForOrderSync } from "./vatSyncValidator.service";

const SOURCE_SYSTEM = process.env.VAT_SYNC_SOURCE_SYSTEM || "inventory";

export const syncVatOrderToTarget = async (orderId: number, declaredBy?: number | null) => {
  const sourceOrder = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        orderBy: { id: "asc" },
      },
      orderOnPayments: {
        where: {
          deletedAt: null,
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!sourceOrder) {
    throw new Error(`Source order not found. id=${orderId}`);
  }

  if (Number(sourceOrder.vat_status ?? 0) !== 1) {
    throw new Error(`Order ${orderId} is not declared for VAT`);
  }

  await validateTargetReferencesForOrderSync(sourceOrder);

  return prismaSecondary.$transaction(async (tx) => {
    const existingTargetOrder = await tx.order.findUnique({
      where: {
        sourceSystem_sourceOrderId: {
          sourceSystem: SOURCE_SYSTEM,
          sourceOrderId: sourceOrder.id,
        },
      },
      select: {
        id: true,
        ref: true,
      },
    });

    let targetOrderId: number;
    let targetRef: string;

    if (!existingTargetOrder) {
      targetRef = await getNextTargetOrderRef(sourceOrder.branchId);

      const created = await tx.order.create({
        data: {
          branchId: sourceOrder.branchId,
          customerId: sourceOrder.customerId,
          OrderSaleType: sourceOrder.OrderSaleType,
          ref: targetRef,
          orderDate: sourceOrder.orderDate,
          status: sourceOrder.status,
          returnstatus: sourceOrder.returnstatus,
          taxRate: sourceOrder.taxRate,
          taxNet: sourceOrder.taxNet,
          discount: sourceOrder.discount,
          shipping: sourceOrder.shipping,
          totalAmount: sourceOrder.totalAmount,
          exchangeRate: sourceOrder.exchangeRate,
          paidAmount: sourceOrder.paidAmount,
          note: sourceOrder.note,
          delReason: sourceOrder.delReason,
          approvedAt: sourceOrder.approvedAt,
          approvedBy: sourceOrder.approvedBy,
          createdAt: sourceOrder.createdAt,
          createdBy: sourceOrder.createdBy,
          updatedAt: sourceOrder.updatedAt ?? new Date(),
          updatedBy: sourceOrder.updatedBy,
          deletedAt: sourceOrder.deletedAt,
          deletedBy: sourceOrder.deletedBy,
          vat_status: sourceOrder.vat_status,
          declared_at: sourceOrder.declared_at ?? new Date(),
          declared_by: declaredBy ?? sourceOrder.declared_by,

          sourceSystem: SOURCE_SYSTEM,
          sourceOrderId: sourceOrder.id,
          sourceRef: sourceOrder.ref,
        },
        select: {
          id: true,
          ref: true,
        },
      });

      targetOrderId = created.id;
      targetRef = created.ref;
    } else {
      targetOrderId = existingTargetOrder.id;
      targetRef = existingTargetOrder.ref;

      await tx.order.update({
        where: { id: targetOrderId },
        data: {
          branchId: sourceOrder.branchId,
          customerId: sourceOrder.customerId,
          OrderSaleType: sourceOrder.OrderSaleType,
          orderDate: sourceOrder.orderDate,
          status: sourceOrder.status,
          returnstatus: sourceOrder.returnstatus,
          taxRate: sourceOrder.taxRate,
          taxNet: sourceOrder.taxNet,
          discount: sourceOrder.discount,
          shipping: sourceOrder.shipping,
          totalAmount: sourceOrder.totalAmount,
          exchangeRate: sourceOrder.exchangeRate,
          paidAmount: sourceOrder.paidAmount,
          note: sourceOrder.note,
          delReason: sourceOrder.delReason,
          approvedAt: sourceOrder.approvedAt,
          approvedBy: sourceOrder.approvedBy,
          createdAt: sourceOrder.createdAt,
          createdBy: sourceOrder.createdBy,
          updatedAt: sourceOrder.updatedAt ?? new Date(),
          updatedBy: sourceOrder.updatedBy,
          deletedAt: sourceOrder.deletedAt,
          deletedBy: sourceOrder.deletedBy,
          vat_status: sourceOrder.vat_status,
          declared_at: sourceOrder.declared_at ?? new Date(),
          declared_by: declaredBy ?? sourceOrder.declared_by,
          sourceRef: sourceOrder.ref,
        },
      });

      await tx.orderItem.deleteMany({
        where: { orderId: targetOrderId },
      });
    }

    if (sourceOrder.items.length > 0) {
      await tx.orderItem.createMany({
        data: sourceOrder.items.map((item) => ({
          orderId: targetOrderId,
          productId: item.productId,
          productVariantId: item.productVariantId,
          serviceId: item.serviceId,
          ItemType: item.ItemType,
          unitId: item.unitId,
          unitQty: item.unitQty,
          baseQty: item.baseQty,
          cogs: item.cogs,
          taxNet: item.taxNet,
          taxMethod: item.taxMethod,
          discount: item.discount,
          discountMethod: item.discountMethod,
          total: item.total,
          quantity: item.quantity,
          price: item.price,
          costPerBaseUnit: item.costPerBaseUnit,
        })),
      });
    }

    for (const payment of sourceOrder.orderOnPayments) {
      const existingTargetPayment = await tx.orderOnPayments.findUnique({
        where: {
          sourceSystem_sourcePaymentId: {
            sourceSystem: SOURCE_SYSTEM,
            sourcePaymentId: payment.id,
          },
        },
        select: {
          id: true,
        },
      });

      if (!existingTargetPayment) {
        await tx.orderOnPayments.create({
          data: {
            branchId: payment.branchId,
            orderId: targetOrderId,
            paymentDate: payment.paymentDate,
            paymentMethodId: payment.paymentMethodId,
            totalPaid: payment.totalPaid,
            receive_usd: payment.receive_usd,
            receive_khr: payment.receive_khr,
            exchangerate: payment.exchangerate,
            createdAt: payment.createdAt,
            createdBy: payment.createdBy,
            updatedAt: payment.updatedAt ?? new Date(),
            updatedBy: payment.updatedBy,
            deletedAt: payment.deletedAt,
            deletedBy: payment.deletedBy,
            delReason: payment.delReason,
            status: payment.status,
            sourceSystem: SOURCE_SYSTEM,
            sourcePaymentId: payment.id,
          },
        });
      } else {
        await tx.orderOnPayments.update({
          where: { id: existingTargetPayment.id },
          data: {
            branchId: payment.branchId,
            orderId: targetOrderId,
            paymentDate: payment.paymentDate,
            paymentMethodId: payment.paymentMethodId,
            totalPaid: payment.totalPaid,
            receive_usd: payment.receive_usd,
            receive_khr: payment.receive_khr,
            exchangerate: payment.exchangerate,
            createdAt: payment.createdAt,
            createdBy: payment.createdBy,
            updatedAt: payment.updatedAt ?? new Date(),
            updatedBy: payment.updatedBy,
            deletedAt: payment.deletedAt,
            deletedBy: payment.deletedBy,
            delReason: payment.delReason,
            status: payment.status,
          },
        });
      }
    }

    return {
      sourceOrderId: sourceOrder.id,
      targetOrderId,
      targetRef,
    };
  });
};