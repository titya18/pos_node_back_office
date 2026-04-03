import { Request, Response } from "express";
import { ItemType } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
import { Decimal } from "@prisma/client/runtime/library"
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { getQueryNumber, getQueryString } from "../utils/request";
import { computeBaseQty } from "../utils/uom";
import { consumeFifoForSale } from "../utils/consumeFifoForSale";

import { createVatSyncLog } from "../services/vatSyncLog.service";
import { syncVatOrderToTarget } from "../services/syncVatOrderToTarget.service";
import { syncVatPaymentToTarget } from "../services/syncVatPaymentToTarget.service";
import { deleteVatPaymentFromTarget } from "../services/deleteVatPaymentFromTarget.service";
import { prisma } from "../lib/prisma";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

export const getAllInvoices = async (req: Request, res: Response): Promise<void> => {
    try {
        // const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        // const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        // const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        // const sortField = req.query.sortField ? req.query.sortField.toString() : "ref";
        // const sortOrder = req.query.sortOrder === "asc" ? "desc" : "asc";
        // const offset = (pageNumber - 1) * pageSize;
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;

        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const rawSortField = getQueryString(req.query.sortField, "ref")!;
        const sortField = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawSortField) ? rawSortField : "ref";

        const sortOrder =
        getQueryString(req.query.sortOrder)?.toLowerCase() === "asc" ? "desc" : "asc";

        const offset = (pageNumber - 1) * pageSize;

        const loggedInUser = req.user;
        if (!loggedInUser) {
            res.status(401).json({ message: "User is not authenticated." });
            return;
        }

        // Base LIKE term
        const likeTerm = `%${searchTerm}%`;

        // Split into words ("Lorn Titya")
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        // Build full name conditions
        const fullNameConditions = searchWords
            .map((_, idx) => `
                (c."firstName" ILIKE $${idx + 2} OR c."lastName" ILIKE $${idx + 2}
                 OR u."firstName" ILIKE $${idx + 2} OR u."lastName" ILIKE $${idx + 2}
                 OR cs."name" ILIKE $${idx + 2}
                 OR br."name" ILIKE $${idx + 2})
            `)
            .join(" AND ");

        // Build parameters: $1 = likeTerm, $2..$n = searchword, $n+1 = limit, $n+2 = offset
        const params = [likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // Branch restriction
        let branchRestriction = "";
        if (loggedInUser.roleType === "USER" && loggedInUser.branchId) {
            branchRestriction = `
                AND rd."branchId" = ${loggedInUser.branchId}
                AND rd."createdBy" = ${loggedInUser.id}
            `;
        }

        // If we want to use this AND condition, we need to copy it and past below WHERE 1=1 ${branchRestriction}
        // AND (
        //             rd."status" NOT IN ('COMPLETED', 'CANCELLED')
        //             OR rd."orderDate"::date >= CURRENT_DATE
        //         )

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Order" rd
            LEFT JOIN "Customer" cs ON rd."customerId" = cs.id
            LEFT JOIN "Branch" br ON rd."branchId" = br.id
            LEFT JOIN "User" c ON rd."createdBy" = c.id
            LEFT JOIN "User" u ON rd."updatedBy" = u.id
            LEFT JOIN "User" ab ON rd."approvedBy" = ab.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    rd."ref" ILIKE $1
                    OR cs."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(rd."orderDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // If we want to use this AND condition, we need to copy it and past below WHERE 1=1 ${branchRestriction}
        // AND (
        //     rd."status" NOT IN ('COMPLETED', 'CANCELLED')
        //     OR rd."orderDate"::date >= CURRENT_DATE
        // )
        // ----- 2) DATA FETCH -----
        const invoices: any = await prisma.$queryRawUnsafe(`
            SELECT rd.*,
                   json_build_object('id', cs.id, 'name', cs.name) AS customer,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                   json_build_object('id', ab.id, 'firstName', ab."firstName", 'lastName', ab."lastName") AS approver
            FROM "Order" rd
            LEFT JOIN "Customer" cs ON rd."customerId" = cs.id
            LEFT JOIN "Branch" br ON rd."branchId" = br.id
            LEFT JOIN "User" c ON rd."createdBy" = c.id
            LEFT JOIN "User" u ON rd."updatedBy" = u.id
            LEFT JOIN "User" ab ON rd."approvedBy" = ab.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    rd."ref" ILIKE $1
                    OR cs."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(rd."orderDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(rd."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY rd."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: invoices, total });

    } catch (error) {
        console.error("Error fetching invoices:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const getNextInvoiceRef = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { branchId } = req.params;
        const branchIdNumber = branchId ? (Array.isArray(branchId) ? Number(branchId[0]) : Number(branchId)) : 0;

        if (!branchIdNumber) {
            res.status(400).json({ message: "Branch ID is required" });
            return;
        }

        const year = new Date().getFullYear(); // 2026, 2027, etc
        const prefix = `ZM${year}-`;

        // Find last invoice of THIS YEAR only
        const lastInvoice = await prisma.order.findFirst({
            where: {
                branchId: Number(branchIdNumber),
                ref: {
                    startsWith: prefix, // ZM2026-
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

        if (lastInvoice?.ref) {
            const lastPart = lastInvoice.ref.split("-")[1]; // 0001
            nextNumber = parseInt(lastPart, 10) + 1;
        }

        const nextRef = `${prefix}${String(nextNumber).padStart(4, "0")}`;

        res.json({ ref: nextRef });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to generate invoice ref" });
    }
};

export const upsertInvoice = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const {
    ref,
    branchId,
    customerId,
    taxRate,
    taxNet,
    discount,
    shipping,
    totalAmount,
    status,
    note,
    items,
    orderDate,
    OrderSaleType,
  } = req.body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const loggedInUser = req.user;
      if (!loggedInUser) {
        throw new Error("User is not authenticated.");
      }

      const invoiceId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

      const existingInvoice = invoiceId
        ? await tx.order.findUnique({
            where: { id: invoiceId },
            select: { status: true },
          })
        : null;

      if (invoiceId && !existingInvoice) {
        throw new Error("Invoice not found!");
      }

      if (invoiceId && existingInvoice?.status === "APPROVED") {
        throw new Error("Approved invoice cannot be edited directly.");
      }

      const checkRef = await tx.order.findFirst({
        where: {
          branchId: Number(branchId),
          ref,
          ...(invoiceId ? { id: { not: invoiceId } } : {}),
        },
      });

      if (checkRef) {
        throw new Error("Invoice # already exists!");
      }

      const lastExchange = await tx.exchangeRates.findFirst({
        orderBy: { id: "desc" },
      });

      const normalizedItems = await Promise.all(
        (items || []).map(async (detail: any) => {
          if (detail.ItemType === "SERVICE") {
            return {
              ItemType: "SERVICE",
              serviceId: detail.serviceId ? Number(detail.serviceId) : null,
              productId: null,
              productVariantId: null,

              unitId: null,
              unitQty: null,
              baseQty: null,

              price: new Decimal(detail.price ?? 0),
              costPerBaseUnit: new Decimal(0),
              taxNet: new Decimal(detail.taxNet ?? 0),
              taxMethod: detail.taxMethod ?? "Include",
              discount: new Decimal(detail.discount ?? 0),
              discountMethod: detail.discountMethod ?? "Fixed",
              total: new Decimal(detail.total ?? 0),
              quantity: Number(detail.quantity ?? 1),
            };
          }

          const { unitId, unitQty, baseQty } = await computeBaseQty(tx, detail);

          return {
            ItemType: "PRODUCT",
            productId: detail.productId ? Number(detail.productId) : null,
            productVariantId: detail.productVariantId ? Number(detail.productVariantId) : null,
            serviceId: null,

            unitId,
            unitQty,
            baseQty,

            price: new Decimal(detail.price ?? 0),
            costPerBaseUnit: new Decimal(detail.costPerBaseUnit ?? 0),
            taxNet: new Decimal(detail.taxNet ?? 0),
            taxMethod: detail.taxMethod ?? "Include",
            discount: new Decimal(detail.discount ?? 0),
            discountMethod: detail.discountMethod ?? "Fixed",
            total: new Decimal(detail.total ?? 0),
            quantity: Number(detail.unitQty ?? detail.quantity ?? 0),

            serialSelectionMode: detail.serialSelectionMode ?? "AUTO",
            selectedTrackedItemIds: Array.isArray(detail.selectedTrackedItemIds)
              ? detail.selectedTrackedItemIds.map(Number)
              : [],
          };
        })
      );

      const invoicePayload = {
        ref,
        branchId: Number(branchId),
        customerId: customerId ? Number(customerId) : null,
        orderDate: new Date(dayjs(orderDate).format("YYYY-MM-DD")),
        OrderSaleType,
        taxRate: taxRate ? Number(taxRate) : 0,
        taxNet: taxNet ? Number(taxNet) : 0,
        discount: discount ? Number(discount) : 0,
        shipping: shipping ? Number(shipping) : 0,
        totalAmount: Number(totalAmount ?? 0),
        exchangeRate: lastExchange?.amount ?? 0,
        status,
        note,
        approvedAt: status === "APPROVED" ? currentDate : null,
        approvedBy: status === "APPROVED" ? loggedInUser.id : null,
        updatedAt: currentDate,
        updatedBy: req.user?.id ?? null,
      };

      let invoice;

      if (invoiceId) {
        await tx.orderItemAssetItem.deleteMany({
          where: {
            orderItem: {
              orderId: invoiceId,
            },
          },
        });

        await tx.orderItem.deleteMany({
          where: { orderId: invoiceId },
        });

        invoice = await tx.order.update({
          where: { id: invoiceId },
          data: invoicePayload,
        });
      } else {
        invoice = await tx.order.create({
          data: {
            ...invoicePayload,
            createdAt: currentDate,
            createdBy: req.user?.id ?? null,
          },
        });
      }

      const createdItems = [];

      for (const item of normalizedItems) {
        const {
          selectedTrackedItemIds,
          ...itemData
        } = item as any;

        const serialSelectionMode = item.serialSelectionMode ?? "AUTO";

        const createdItem = await tx.orderItem.create({
          data: {
            ...itemData,
            orderId: invoice.id,
          },
          include: {
            products: true,
            productvariants: true,
            services: true,
          },
        });

        if (
          itemData.ItemType === "PRODUCT" &&
          serialSelectionMode === "MANUAL" &&
          Array.isArray(selectedTrackedItemIds) &&
          selectedTrackedItemIds.length > 0
        ) {
          await tx.orderItemAssetItem.createMany({
            data: selectedTrackedItemIds.map((assetItemId: number) => ({
              orderItemId: createdItem.id,
              productAssetItemId: Number(assetItemId),
            })),
          });
        }

        createdItems.push(createdItem);
      }

      invoice = {
        ...invoice,
        items: createdItems,
      };

      const shouldDeductStock =
        (!existingInvoice && status === "APPROVED") ||
        (existingInvoice?.status !== "APPROVED" && status === "APPROVED");

      if (shouldDeductStock) {
        for (const item of invoice.items) {
          if (item.ItemType !== "PRODUCT" || !item.productVariantId) {
            await tx.orderItem.update({
              where: { id: item.id },
              data: { cogs: new Decimal(0) },
            });
            continue;
          }

          const sellQty =
            (item as any).baseQty != null
              ? new Decimal((item as any).baseQty)
              : new Decimal(item.quantity ?? 0);

          // ✅ ADD HERE START
          const variant = await tx.productVariants.findUnique({
            where: { id: item.productVariantId },
            select: {
              id: true,
              trackingType: true,
            },
          });

          let selectedAssetRows = await tx.orderItemAssetItem.findMany({
            where: { orderItemId: item.id },
            include: {
              productAssetItem: true,
            },
          });

          if (variant?.trackingType !== "NONE") {
            // AUTO mode: no manual serial selected yet
            if (selectedAssetRows.length === 0) {
              const autoRows = await tx.productAssetItem.findMany({
                where: {
                  productVariantId: item.productVariantId,
                  branchId: invoice.branchId,
                  status: "IN_STOCK",
                },
                orderBy: [
                  { serialNumber: "asc" },
                  { assetCode: "asc" },
                  { id: "asc" },
                ],
                take: Number(sellQty),
              });

              if (autoRows.length !== Number(sellQty)) {
                throw new Error(
                  `Not enough tracked serials available for product ${item.productvariants?.barcode || item.id}`
                );
              }

              await tx.orderItemAssetItem.createMany({
                data: autoRows.map((row) => ({
                  orderItemId: item.id,
                  productAssetItemId: row.id,
                })),
              });

              selectedAssetRows = autoRows.map((row) => ({
                orderItemId: item.id,
                productAssetItemId: row.id,
                productAssetItem: row,
              })) as any;
            } else {
              // MANUAL mode: seller selected exact serials
              if (selectedAssetRows.length !== Number(sellQty)) {
                throw new Error(
                  `Selected serial count does not match qty for product ${item.productvariants?.barcode || item.id}`
                );
              }
            }

            for (const link of selectedAssetRows) {
              const assetItem = link.productAssetItem;

              if (!assetItem) {
                throw new Error("Tracked item not found");
              }

              if (assetItem.status !== "IN_STOCK") {
                throw new Error(`Serial is not available: ${assetItem.serialNumber}`);
              }

              if (assetItem.branchId !== invoice.branchId) {
                throw new Error(`Serial is not in invoice branch: ${assetItem.serialNumber}`);
              }

              if (assetItem.productVariantId !== item.productVariantId) {
                throw new Error(`Serial does not belong to selected product: ${assetItem.serialNumber}`);
              }
            }
          }
          // ✅ ADD HERE END

          const stock = await tx.stocks.findUnique({
            where: {
              productVariantId_branchId: {
                productVariantId: item.productVariantId,
                branchId: invoice.branchId,
              },
            },
          });

          if (!stock || stock.quantity.lt(sellQty)) {
            throw new Error(
              "Insufficient stock for barcode: " + item.productvariants?.barcode
            );
          }

          const totalCogs = await consumeFifoForSale({
            tx,
            productVariantId: item.productVariantId,
            branchId: invoice.branchId,
            orderItemId: item.id,
            invoiceRef: invoice.ref,
            sellQty,
            userId: loggedInUser.id,
            currentDate,
          });

          await tx.orderItem.update({
            where: { id: item.id },
            data: {
              cogs: totalCogs,
            },
          });

          await tx.stocks.update({
            where: { id: stock.id },
            data: {
              quantity: { decrement: sellQty },
              updatedAt: currentDate,
              updatedBy: loggedInUser.id,
            },
          });

          // ✅ ADD HERE START
          if (variant?.trackingType !== "NONE") {
            for (const link of selectedAssetRows) {
              await tx.productAssetItem.update({
                where: { id: link.productAssetItemId },
                data: {
                  status: "SOLD",
                  soldOrderItemId: item.id,
                  updatedAt: currentDate,
                  updatedBy: loggedInUser.id,
                },
              });
            }
          }
          // ✅ ADD HERE END
        }
      }

      return await tx.order.findUnique({
        where: { id: invoice.id },
        include: {
          items: {
            include: {
              products: true,
              productvariants: true,
              services: true,
            },
          },
        },
      });
    });

    res.status(id ? 200 : 201).json(result);
  } catch (error) {
    logger.error("Error creating/updating invoice:", error);
    const typedError = error as Error;
    res.status(500).json({ message: typedError.message });
  }
};

export const insertInvoicePayment = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await prisma.$transaction(async (tx) => {
            const loggedInUser = req.user;
            if (!loggedInUser) {
                throw new Error("User is not authenticated.");
            }

            const { branchId, orderId, paymentMethodId, totalPaid, receive_usd, receive_khr, exchangerate, due_balance } = req.body;

            const invoice = await tx.order.findUnique({
                where: { id: Number(orderId) },
                select: { 
                    totalAmount: true, 
                    paidAmount: true,
                    vat_status: true,
                },
            });

            if (!invoice) {
                throw new Error("Invoice not found");
            }

            const paidAmountNumber = invoice.paidAmount ? invoice.paidAmount.toNumber() : 0;
            const amountNumber = Number(totalPaid);
            const totalAmountNumber = invoice.totalAmount ? invoice.totalAmount.toNumber() : 0;

            const newPaidAmount = totalAmountNumber <= amountNumber
                ? totalAmountNumber
                : (totalAmountNumber - paidAmountNumber) <= amountNumber
                ? totalAmountNumber
                : (paidAmountNumber + amountNumber);

            await tx.order.update({
                where: { id: Number(orderId) },
                data: {
                    paidAmount: newPaidAmount,
                    ...(Number(due_balance) <= 0 && {
                        status: "COMPLETED",
                    })
                }
            });

            const amountNum = Number(totalPaid);
            const dueNum = Number(due_balance);
            const finalAmount = dueNum <= 0
                ? new Decimal(amountNum).plus(dueNum)
                : new Decimal(amountNum);

            const invoicePayment = await tx.orderOnPayments.create({
                data: {
                    branchId: parseInt(branchId, 10),
                    orderId: parseInt(orderId, 10),
                    paymentMethodId: parseInt(paymentMethodId, 10),
                    paymentDate: currentDate,
                    totalPaid: finalAmount,
                    receive_usd,
                    receive_khr,
                    exchangerate,
                    createdAt: currentDate,
                    createdBy: req.user ? req.user.id : null,
                    updatedAt: currentDate,
                    updatedBy: req.user ? req.user.id : null,
                    status: "PAID"
                },
                include: {
                    orders: true,
                }
            });

            return invoicePayment;
        });

        // ===========================
        // VAT PAYMENT SYNC AFTER SAVE SUCCESS
        // ===========================
        if (result && Number(result.orders?.vat_status ?? 0) === 1) {
            const log = await createVatSyncLog({
                entityType: "PAYMENT",
                entityId: result.id,
                orderId: result.orderId,
                actionType: "UPSERT_PAYMENT",
                status: "PENDING",
            });

            try {
                await syncVatPaymentToTarget(result.id);

                await prisma.vatSyncLog.update({
                    where: { id: log.id },
                    data: {
                        status: "DONE",
                        syncedAt: new Date(),
                        errorMessage: null,
                    },
                });
            } catch (error: any) {
                await prisma.vatSyncLog.update({
                    where: { id: log.id },
                    data: {
                        status: "FAILED",
                        retryCount: { increment: 1 },
                        errorMessage: error?.message ?? "Payment sync failed",
                    },
                });
            }
        }

        res.status(201).json(result);
    } catch (error) {
        logger.error("Error inserting invoice payment:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getInvoiceById = async (
    req: Request,
    res: Response
): Promise<void> => {
    const { id } = req.params;
    const invoiceId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    try {
        /* ---------------------------------- */
        /* 1️ GET ORDER (BASE DATA)       */
        /* ---------------------------------- */
        const order = await prisma.order.findUnique({
            where: { id: Number(invoiceId) },
            include: {
                branch: true,
                creator: true,
                updater: true,
                customer: true,
                items: {
                    include: {
                        unit: true,
                        products: {
                          select: {
                              id: true,
                              name: true,
                              unitConversions: {
                                select: {
                                    id: true,
                                    productId: true,
                                    fromUnitId: true,
                                    toUnitId: true,
                                    multiplier: true,
                                    fromUnit: { select: { id: true, name: true, type: true } },
                                    toUnit: { select: { id: true, name: true, type: true } },
                                },
                              },
                          },
                        },
                        productvariants: {
                          select: {
                              id: true,
                              name: true,
                              barcode: true,
                              sku: true,
                              productType: true,
                              trackingType: true,
                              baseUnitId: true,
                              retailPrice: true,
                              retailPriceUnitId: true,
                              wholeSalePrice: true,
                              wholeSalePriceUnitId: true,
                              baseUnit: { select: { id: true, name: true, type: true } },
                          },
                        },
                        services: true,
                        selectedAssetItems: {
                          include: {
                            productAssetItem: true,
                          },
                        },
                    },
                },
            },
        });

        if (!order) {
            res.status(404).json({ message: "Order not found!" });
            return;
        }

        /* ---------------------------------- */
        /* 2️ EXTRACT IDS FOR STOCK QUERY    */
        /* ---------------------------------- */
        const branchId = order.branchId;

        const variantIds = order.items
            .filter(detail => detail.ItemType === "PRODUCT")
            .map(detail => detail.productVariantId)
            .filter((id): id is number => id != null);

        /* ---------------------------------- */
        /* 3️ QUERY STOCKS (ONE QUERY ONLY) */
        /* ---------------------------------- */
        const stocks = await prisma.stocks.findMany({
            where: {
                branchId,
                productVariantId: {
                    in: variantIds,
                },
            },
            select: {
                productVariantId: true,
                quantity: true,
            },
        });

        /* ---------------------------------- */
        /* 4️ MAP STOCKS FOR FAST LOOKUP     */
        /* ---------------------------------- */
        const stockMap = new Map<number, number>(
            stocks.map((s) => [
                s.productVariantId,
                Number(s.quantity),
            ])
        );

        /* ---------------------------------- */
        /* 5️ MERGE STOCK INTO DETAILS       */
        /* ---------------------------------- */
        order.items = order.items.map(
            (detail: any) => {
                if (detail.ItemType === "PRODUCT") {
                    return {
                        ...detail,
                        name: detail.productvariants?.name ?? "",
                        barcode: detail.productvariants?.barcode ?? null,
                        sku: detail.productvariants?.sku ?? null,
                        stocks:
                            stockMap.get(detail.productVariantId) ?? 0,
                    };
                }

                // SERVICE item (no stock)
                return {
                    ...detail,
                    name: detail.services?.name ?? "",
                    barcode: null,
                    sku: null,
                    stocks: null,
                };
            }
        );

        /* ---------------------------------- */
        /* 6️ SEND RESPONSE                  */
        /* ---------------------------------- */
        res.status(200).json(order);
    } catch (error) {
        console.error("Error fetching order by ID:", error);
        res.status(500).json({
            message: "Error fetching order by ID",
        });
    }
};

export const getInvoicePaymentById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const orderId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    try {
        const purchasePayment = await prisma.orderOnPayments.findMany({ 
            where: { 
                orderId: Number(orderId),
                status: 'PAID'
            },
            orderBy: { id: 'desc' },
            include: {
                paymentMethods: {
                    select: {
                        name: true
                    }
                }
            } 
        });
        res.status(200).json(purchasePayment);
    } catch (error) {
        logger.error("Error fetching invoice payment by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}

export const deletePayment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const paymentId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    const { delReason } = req.body;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const payment = await tx.orderOnPayments.findUnique({
                where: { id: Number(paymentId) },
                include: {
                    orders: true,
                }
            });

            if (!payment) {
                throw new Error("Payment not found!");
            }

            await tx.orderOnPayments.update({
                where: { id: Number(paymentId) },
                data: {
                    deletedAt: currentDate,
                    deletedBy: req.user ? req.user.id : null,
                    delReason,
                    status: "CANCELLED",
                    updatedAt: currentDate,
                    updatedBy: req.user ? req.user.id : null,
                }
            });

            await tx.order.update({
                where: { id: payment.orderId },
                data: {
                    paidAmount: {
                        decrement: payment.totalPaid.toNumber()
                    },
                    ...(payment.orders && payment.orders.status === "COMPLETED" && {
                        status: "APPROVED"
                    })
                }
            });

            return payment;
        });

        // ===========================
        // VAT PAYMENT DELETE SYNC
        // ===========================
        if (result && Number(result.orders?.vat_status ?? 0) === 1) {
            const log = await createVatSyncLog({
                entityType: "PAYMENT",
                entityId: result.id,
                orderId: result.orderId,
                actionType: "DELETE_PAYMENT",
                status: "PENDING",
            });

            try {
                await deleteVatPaymentFromTarget(result.id);

                await prisma.vatSyncLog.update({
                    where: { id: log.id },
                    data: {
                        status: "DONE",
                        syncedAt: new Date(),
                        errorMessage: null,
                    },
                });
            } catch (error: any) {
                await prisma.vatSyncLog.update({
                    where: { id: log.id },
                    data: {
                        status: "FAILED",
                        retryCount: { increment: 1 },
                        errorMessage: error?.message ?? "Delete payment sync failed",
                    },
                });
            }
        }

        res.status(200).json(result);
    } catch (error) {
        logger.error("Error deleting payment:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteInvoice = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const orderId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    const { delReason } = req.body;
    try {
        const order = await prisma.order.findUnique({ 
            where: { id: Number(orderId) },
            include: { items: true } 
        });
        if (!order) {
            res.status(404).json({ message: "Invoice not found!" });
            return;
        }
        await prisma.order.update({
            where: { id: Number(orderId) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason,
                status: "CANCELLED"
            }
        });
        res.status(200).json(order);
    } catch (error) {
        logger.error("Error deleting invoice:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const approveInvoice = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const orderId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const loggedInUser = req.user;
      if (!loggedInUser) {
        throw new Error("User is not authenticated.");
      }

      const invoice = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              products: true,
              productvariants: true,
              services: true,
            },
          },
        },
      });

      if (!invoice) throw new Error("Invoice not found");
      if (invoice.approvedAt) throw new Error("Invoice already approved");

      for (const item of invoice.items) {
        if (item.ItemType !== "PRODUCT" || !item.productVariantId) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: { cogs: new Decimal(0) },
          });
          continue;
        }

        const sellQty =
          (item as any).baseQty != null
            ? new Decimal((item as any).baseQty)
            : new Decimal(item.quantity ?? 0);

        const stock = await tx.stocks.findUnique({
          where: {
            productVariantId_branchId: {
              productVariantId: item.productVariantId,
              branchId: invoice.branchId,
            },
          },
        });

        if (!stock || stock.quantity.lt(sellQty)) {
          throw new Error(
            "Insufficient stock for barcode: " + item.productvariants?.barcode
          );
        }

        const totalCogs = await consumeFifoForSale({
          tx,
          productVariantId: item.productVariantId,
          branchId: invoice.branchId,
          orderItemId: item.id,
          invoiceRef: invoice.ref,
          sellQty,
          userId: loggedInUser.id,
          currentDate,
        });

        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            cogs: totalCogs,
          },
        });

        await tx.stocks.update({
          where: { id: stock.id },
          data: {
            quantity: { decrement: sellQty },
            updatedAt: currentDate,
            updatedBy: loggedInUser.id,
          },
        });
      }

      return await tx.order.update({
        where: { id: invoice.id },
        data: {
          approvedAt: currentDate,
          approvedBy: loggedInUser.id,
          status: "APPROVED",
          updatedAt: currentDate,
          updatedBy: loggedInUser.id,
        },
        include: {
          items: true,
        },
      });
    });

    res.status(200).json(result);
  } catch (error) {
    logger.error("Error approve invoice:", error);
    const typedError = error as Error;
    res.status(500).json({ message: typedError.message });
  }
};

export const declareInvoiceToVat = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const orderId = id ? (Array.isArray(id) ? id[0] : id) : 0;

  try {
    const updatedOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: Number(orderId) },
        include: {
          items: true,
          orderOnPayments: true,
        },
      });

      if (!order) {
        throw new Error("Invoice not found!");
      }

      if (Number(order.vat_status ?? 0) === 1) {
        throw new Error("Invoice already declared to VAT.");
      }

      return await tx.order.update({
        where: { id: Number(orderId) },
        data: {
          vat_status: 1,
          declared_at: currentDate,
          declared_by: req.user ? req.user.id : null,
          updatedAt: currentDate,
          updatedBy: req.user ? req.user.id : null,
        },
        include: {
          items: true,
          orderOnPayments: true,
        },
      });
    });

    const log = await createVatSyncLog({
      entityType: "ORDER",
      entityId: updatedOrder.id,
      orderId: updatedOrder.id,
      actionType: "UPSERT_ORDER",
      status: "PENDING",
    });

    try {
      await syncVatOrderToTarget(updatedOrder.id, req.user?.id ?? null);

      await prisma.vatSyncLog.update({
        where: { id: log.id },
        data: {
          status: "DONE",
          syncedAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error: any) {
      await prisma.vatSyncLog.update({
        where: { id: log.id },
        data: {
          status: "FAILED",
          retryCount: { increment: 1 },
          errorMessage: error?.message ?? "Order sync failed",
        },
      });
    }

    res.status(200).json(updatedOrder);
  } catch (error) {
    logger.error("Error declare invoice:", error);
    const typedError = error as Error;
    res.status(500).json({ message: typedError.message });
  }
};

export const getAvailableTrackedItems = async (req: Request, res: Response): Promise<void> => {
  const { productVariantId, branchId, orderItemId } = req.query;

  try {
    const variantId = Number(productVariantId);
    const branchIdNum = Number(branchId);
    const orderItemIdNum = orderItemId ? Number(orderItemId) : 0;

    if (!variantId || !branchIdNum) {
      res.status(400).json({ message: "productVariantId and branchId are required" });
      return;
    }

    let selectedIds: number[] = [];

    if (orderItemIdNum && Number.isInteger(orderItemIdNum) && orderItemIdNum > 0 && orderItemIdNum <= 2147483647) {
      const selectedRows = await prisma.orderItemAssetItem.findMany({
        where: {
          orderItemId: orderItemIdNum,
        },
        select: {
          productAssetItemId: true,
        },
      });

      selectedIds = selectedRows.map((row) => row.productAssetItemId);
    }

    const rows = await prisma.productAssetItem.findMany({
      where: {
        productVariantId: variantId,
        branchId: branchIdNum,
        OR: [
          { status: "IN_STOCK" },
          ...(selectedIds.length > 0 ? [{ id: { in: selectedIds } }] : []),
        ],
      },
      orderBy: [
        { serialNumber: "asc" },
        { assetCode: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        branchId: true,
        serialNumber: true,
        assetCode: true,
        macAddress: true,
        status: true,
        soldOrderItemId: true,
      },
    });

    res.status(200).json(rows);
  } catch (error: any) {
    logger.error("Error fetching available tracked items:", error);
    res.status(500).json({ message: error.message });
  }
};