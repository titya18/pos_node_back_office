import dayjs from "dayjs";
import { prismaSecondary } from "../lib/prisma";

/**
 * Example format:
 * OR2026-00001
 * Change this logic if your DB2 uses another format.
 */
export const getNextTargetOrderRef = async (branchId: number): Promise<string> => {
  const year = dayjs().year();
  const prefix = `OR${year}-`;

  const lastOrder = await prismaSecondary.order.findFirst({
    where: {
      branchId,
      ref: {
        startsWith: prefix,
      },
    },
    orderBy: {
      id: "desc",
    },
    select: {
      ref: true,
    },
  });

  let nextNumber = 1;

  if (lastOrder?.ref) {
    const match = lastOrder.ref.match(/(\d+)$/);
    const lastNumber = match ? Number(match[1]) : 0;
    nextNumber = lastNumber + 1;
  }

  return `${prefix}${String(nextNumber).padStart(5, "0")}`;
};