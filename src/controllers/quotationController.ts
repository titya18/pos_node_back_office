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
import { consumeFifoForSale } from "../utils/consumeFifoForSale"
import { prisma } from "../lib/prisma";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

export const getAllQuotations = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const rawSortField = getQueryString(req.query.sortField, "ref")!;
        const sortField = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawSortField) ? rawSortField : "ref";
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "asc" ? "desc" : "asc";
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
                AND q."branchId" = ${loggedInUser.branchId}
                AND q."createdBy" = ${loggedInUser.id}
            `;
        }

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Quotations" q
            LEFT JOIN "Customer" cs ON q."customerId" = cs.id
            LEFT JOIN "Branch" br ON q."branchId" = br.id
            LEFT JOIN "User" c ON q."createdBy" = c.id
            LEFT JOIN "User" u ON q."updatedBy" = u.id
            LEFT JOIN "User" sb ON q."sentBy" = sb.id
            LEFT JOIN "User" ib ON q."invoicedBy" = ib.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    q."ref" ILIKE $1
                    OR cs."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(q."quotationDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."sentAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."invoicedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."sentAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."invoicedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // ----- 2) DATA FETCH -----
        const quotations: any = await prisma.$queryRawUnsafe(`
            SELECT q.*,
                   json_build_object('id', cs.id, 'name', cs.name) AS customer,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                   json_build_object('id', sb.id, 'firstName', sb."firstName", 'lastName', sb."lastName") AS sender,
                   json_build_object('id', ib.id, 'firstName', ib."firstName", 'lastName', ib."lastName") AS invoicer
            FROM "Quotations" q
            LEFT JOIN "Customer" cs ON q."customerId" = cs.id
            LEFT JOIN "Branch" br ON q."branchId" = br.id
            LEFT JOIN "User" c ON q."createdBy" = c.id
            LEFT JOIN "User" u ON q."updatedBy" = u.id
            LEFT JOIN "User" sb ON q."sentBy" = sb.id
            LEFT JOIN "User" ib ON q."invoicedBy" = ib.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    q."ref" ILIKE $1
                    OR cs."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(q."quotationDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."sentAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."invoicedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."sentAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(q."invoicedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY q."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: quotations, total });

    } catch (error) {
        console.error("Error fetching quotations:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const getNextQuotationRef = async (req: Request, res: Response): Promise<void> => {
    const { branchId } = req.params;
    const branchIdNumber = branchId ? (Array.isArray(branchId) ? Number(branchId[0]) : Number(branchId)) : 0;

    if (!branchIdNumber) {
        res.status(400).json({ message: "Branch ID is required" });
        return;
    }

    const lastQuotation = await prisma.quotations.findFirst({
        where: {
            branchId: Number(branchIdNumber),
        },
        orderBy: {
            id: "desc",
        },
        select: {
            ref: true,
        },
    });

    let nextRef = "QR-00001";

    if (lastQuotation?.ref) {
        const lastNumber = parseInt(lastQuotation.ref.split("-")[1], 10) || 0;
        nextRef = `QR-${String(lastNumber + 1).padStart(5, "0")}`;
    }

    res.json({ ref: nextRef });
};

export const upsertQuotation = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const {
        ref,
        branchId,
        customerId,
        taxRate,
        taxNet,
        discount,
        shipping,
        grandTotal,
        status,
        note,
        quotationDetails,
        quotationDate,
        QuoteSaleType,
    } = req.body;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const loggedInUser = req.user;
            if (!loggedInUser) {
                throw new Error("User is not authenticated.");
            }

            const quotationId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

            if (quotationId) {
                const checkQuotation = await tx.quotations.findUnique({
                    where: { id: quotationId },
                });

                if (!checkQuotation) {
                    throw new Error("Quotation not found!");
                }
            }

            const checkRef = await tx.quotations.findFirst({
                where: {
                    branchId: Number(branchId),
                    ref,
                    ...(quotationId ? { id: { not: quotationId } } : {}),
                },
            });

            if (checkRef) {
                throw new Error("Quotation # already exists!");
            }

            const normalizedDetails = await Promise.all(
                (quotationDetails || []).map(async (detail: any) => {
                    if (detail.ItemType === "SERVICE") {
                        return {
                            ItemType: "SERVICE",
                            serviceId: detail.serviceId ? Number(detail.serviceId) : null,
                            productId: null,
                            productVariantId: null,

                            unitId: null,
                            unitQty: null,
                            baseQty: null,

                            cost: new Decimal(detail.cost ?? 0),
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

                        cost: new Decimal(detail.cost ?? 0),
                        costPerBaseUnit: new Decimal(detail.costPerBaseUnit ?? 0),
                        taxNet: new Decimal(detail.taxNet ?? 0),
                        taxMethod: detail.taxMethod ?? "Include",
                        discount: new Decimal(detail.discount ?? 0),
                        discountMethod: detail.discountMethod ?? "Fixed",
                        total: new Decimal(detail.total ?? 0),
                        quantity: Number(detail.unitQty ?? detail.quantity ?? 0),
                    };
                })
            );

            const payload = {
                ref,
                branchId: Number(branchId),
                customerId: customerId ? Number(customerId) : null,
                quotationDate: new Date(dayjs(quotationDate).format("YYYY-MM-DD")),
                QuoteSaleType,
                taxRate: taxRate ? Number(taxRate) : 0,
                taxNet: taxNet ? Number(taxNet) : 0,
                discount: discount ? Number(discount) : 0,
                shipping: shipping ? Number(shipping) : 0,
                grandTotal: Number(grandTotal ?? 0),
                status,
                note,
                updatedAt: currentDate,
                updatedBy: req.user?.id ?? null,
                sentAt: status === "SENT" ? currentDate : null,
                sentBy: status === "SENT" ? req.user?.id ?? null : null,
            };

            const quotation = quotationId
                ? await tx.quotations.update({
                    where: { id: quotationId },
                    data: {
                        ...payload,
                        quotationDetails: {
                            deleteMany: { quotationId },
                            create: normalizedDetails,
                        },
                    },
                    include: {
                        quotationDetails: {
                            include: {
                                products: true,
                                productvariants: true,
                                services: true,
                            },
                        },
                    },
                })
                : await tx.quotations.create({
                    data: {
                        ...payload,
                        createdAt: currentDate,
                        createdBy: req.user?.id ?? null,
                        quotationDetails: {
                            create: normalizedDetails,
                        },
                    },
                    include: {
                        quotationDetails: {
                            include: {
                                products: true,
                                productvariants: true,
                                services: true,
                            },
                        },
                    },
                });

            return quotation;
        });

        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error creating/updating quotation:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getQuotationById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const quotationId = Number(Array.isArray(id) ? id[0] : id);

  try {
    /* ---------------------------------- */
    /* 1️⃣ GET QUOTATION (WITH RELATIONS)  */
    /* ---------------------------------- */
    const quotation = await prisma.quotations.findUnique({
      where: { id: quotationId },
      include: {
        branch: true,
        creator: true,
        updater: true,
        customers: true,
        quotationDetails: {
          include: {
            unit: true,

            // ✅ IMPORTANT: include product + unitConversions
            products: {
              include: {
                unitConversions: {
                  include: {
                    fromUnit: { select: { id: true, name: true, type: true } },
                    toUnit: { select: { id: true, name: true, type: true } },
                  },
                },
              },
            },

            // ✅ IMPORTANT: include baseUnit + baseUnitId
            productvariants: {
                select: {
                    id: true,
                    name: true,
                    barcode: true,
                    sku: true,
                    productType: true,
                    baseUnitId: true,
                    retailPrice: true,
                    retailPriceUnitId: true,
                    wholeSalePrice: true,
                    wholeSalePriceUnitId: true,
                    baseUnit: {
                        select: { id: true, name: true, type: true },
                    },
                },
            },

            services: true,
          },
        },
      },
    });

    if (!quotation) {
      res.status(404).json({ message: "Quotation not found!" });
      return;
    }

    /* ---------------------------------- */
    /* 2️⃣ EXTRACT IDS FOR STOCK QUERY     */
    /* ---------------------------------- */
    const branchId = quotation.branchId;

    const variantIds = quotation.quotationDetails
      .filter((d: any) => d.ItemType === "PRODUCT")
      .map((d: any) => d.productVariantId)
      .filter((x: any): x is number => x != null);

    /* ---------------------------------- */
    /* 3️⃣ QUERY STOCKS (ONE QUERY ONLY)   */
    /* ---------------------------------- */
    const stocks = await prisma.stocks.findMany({
      where: {
        branchId,
        productVariantId: { in: variantIds },
      },
      select: {
        productVariantId: true,
        quantity: true,
      },
    });

    const stockMap = new Map<number, number>(
      stocks.map((s) => [s.productVariantId, Number(s.quantity)])
    );

    /* ---------------------------------- */
    /* 4️⃣ MERGE STOCK + NORMALIZE DETAIL  */
    /* ---------------------------------- */
    const details = quotation.quotationDetails.map((detail: any) => {
      if (detail.ItemType === "PRODUCT") {
        const baseUnitId =
          detail.productvariants?.baseUnitId ??
          detail.productvariants?.baseUnit?.id ??
          null;

        return {
          ...detail,

          // ✅ keep useful display fields
          name: detail.productvariants?.name ?? "",
          barcode: detail.productvariants?.barcode ?? null,
          sku: detail.productvariants?.sku ?? null,

          // ✅ stock
          stocks: stockMap.get(detail.productVariantId) ?? 0,

          // ✅ ensure unitId/unitQty exist (so modal can show correct values)
          unitId: detail.unitId ?? baseUnitId,
          unitQty: detail.unitQty ?? detail.quantity ?? 1,

          // (optional) ensure quantity stays synced
          quantity: detail.unitQty ?? detail.quantity ?? 1,
        };
      }

      // SERVICE
      return {
        ...detail,
        name: detail.services?.name ?? "",
        barcode: null,
        sku: null,
        stocks: null,
      };
    });

    /* ---------------------------------- */
    /* 5️⃣ SEND RESPONSE                  */
    /* ---------------------------------- */
    res.status(200).json({
      ...quotation,
      quotationDetails: details,
    });
  } catch (error) {
    console.error("Error fetching quotation by ID:", error);
    res.status(500).json({ message: "Error fetching quotation by ID" });
  }
};

// export const getQuotationById = async (req: Request, res: Response): Promise<void> => {
//     const { id } = req.params;
//     try {
//         const quotation = await prisma.quotations.findUnique({
//             where: { id: parseInt(id, 10) },
//             include: { 
//                 quotationDetails: {
//                     include: {
//                         products: true, // Include related products data
//                         productvariants: {
//                             select: {
//                                 name: true, // Select the `name` field from `productVariant`
//                                 barcode: true,
//                                 sku: true
//                             },
//                         },
//                         services: true, // Include related services data
//                     },
//                 },
//                 customers: true, // Include related customer data
//                 branch: true, // Include related branch data
//                 creator: true, // Include related creator data
//                 updater: true, // Include related updater data
//             }, // Include related quotation details
//         });

//         // Transform data to flatten `name` into `quotationDetails`
//         // if (quotation) {
//         //     quotation.quotationDetails = quotation.quotationDetails.map((detail: any) => ({
//         //         ...detail,
//         //         name: detail.ItemType === "PRODUCT" ? detail.productvariants.name : detail.services.name, // Add `name` directly
//         //     }));
//         // }

//         if (!quotation) {
//             res.status(404).json({ message: "Quotation not found!" });
//             return;
//         }
//         res.status(200).json(quotation);
//     } catch (error) {
//         logger.error("Error fetching quotation by ID:", error);
//         const typedError = error as Error;
//         res.status(500).json({ message: typedError.message });
//     }
// };

export const deleteQuotation = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const quotationId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    const { delReason } = req.body;
    try {
        const quotation = await prisma.quotations.findUnique({ 
            where: { id: Number(quotationId) },
            include: { quotationDetails: true } 
        });

        if (!quotation) {
            res.status(404).json({ message: "Quotation not found!" });
            return;
        }
        await prisma.quotations.update({
            where: { id: Number(quotationId) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason,
                status: "CANCELLED"
            }
        });
        res.status(200).json(quotation);
    } catch (error) {
        logger.error("Error deleting quotation:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const convertQuotationToOrder = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const quotationId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const loggedInUser = req.user;
            if (!loggedInUser) {
                throw new Error("User is not authenticated.");
            }

            const quotation = await tx.quotations.findUnique({
                where: { id: quotationId },
                include: {
                    quotationDetails: {
                        include: {
                            products: true,
                            productvariants: true,
                            services: true,
                        },
                    },
                },
            });

            if (!quotation) {
                throw new Error("Quotation not found");
            }

            if (quotation.invoicedAt) {
                throw new Error("Quotation already converted to order");
            }

            const lastOrder = await tx.order.findFirst({
                where: { branchId: quotation.branchId },
                orderBy: { id: "desc" },
            });

            const year = new Date().getFullYear();
            let ref = `ZM${year}-`;

            if (lastOrder && lastOrder.ref) {
                const refNumber = parseInt(lastOrder.ref.split("-")[1], 10) || 0;
                ref += String(refNumber + 1).padStart(5, "0");
            } else {
                ref += "00001";
            }

            const order = await tx.order.create({
                data: {
                    branchId: quotation.branchId,
                    customerId: quotation.customerId,
                    ref,
                    orderDate: currentDate,
                    OrderSaleType: quotation.QuoteSaleType,
                    taxRate: quotation.taxRate,
                    taxNet: quotation.taxNet,
                    discount: quotation.discount,
                    shipping: quotation.shipping,
                    totalAmount: Number(quotation.grandTotal),
                    createdBy: loggedInUser.id,
                    createdAt: currentDate,
                    updatedAt: currentDate,
                    updatedBy: loggedInUser.id,
                    approvedAt: currentDate,
                    approvedBy: loggedInUser.id,
                    status: "APPROVED",
                    items: {
                        create: quotation.quotationDetails.map((item) => ({
                            ItemType: item.ItemType,
                            taxNet: Number(item.taxNet ?? 0),
                            taxMethod: item.taxMethod,
                            discount: Number(item.discount ?? 0),
                            discountMethod: item.discountMethod,
                            total: Number(item.total ?? 0),

                            quantity: item.quantity,
                            price: Number(item.cost ?? 0),

                            productVariantId: item.productVariantId,
                            productId: item.productId,
                            serviceId: item.serviceId,

                            unitId: item.unitId,
                            unitQty: item.unitQty,
                            baseQty: item.baseQty,
                        })),
                    },
                },
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

            for (const item of order.items) {
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
                            branchId: order.branchId,
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
                    branchId: order.branchId,
                    orderItemId: item.id,
                    invoiceRef: order.ref,
                    sellQty,
                    userId: loggedInUser.id,
                    currentDate,
                });

                await tx.orderItem.update({
                    where: { id: item.id },
                    data: { cogs: totalCogs },
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

            await tx.quotations.update({
                where: { id: quotation.id },
                data: {
                    invoicedAt: currentDate,
                    invoicedBy: loggedInUser.id,
                    status: "INVOICED",
                    updatedAt: currentDate,
                    updatedBy: loggedInUser.id,
                },
            });

            return order;
        });

        res.status(201).json(result);
    } catch (error) {
        logger.error("Error converting quotation to order:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};