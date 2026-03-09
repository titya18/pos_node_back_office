import { Request, Response } from "express";
import { ItemType, PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
import { Decimal } from "@prisma/client/runtime/library"
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { getQueryNumber, getQueryString } from "../utils/request";
import { computeBaseQty } from "../utils/uom";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

const prisma = new PrismaClient();

export const getAllQuotations = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "ref")!;
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
    const { ref, branchId, customerId, taxRate, taxNet, discount, shipping, grandTotal, status, note, quotationDetails, quotationDate, QuoteSaleType } = req.body;
    
    try {
        const result = await prisma.$transaction(async (tx) => {
            const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
            // Verify that loggedInUser is defined
            if (!loggedInUser) {
                res.status(401).json({ message: "User is not authenticated." });
                return;
            }

            const quotationId = id ? (Array.isArray(id) ? id[0] : id) : 0;
            if (quotationId) {
                const checkQuotation = await tx.quotations.findUnique({ where: { id: Number(quotationId) } });
                if (!checkQuotation) {
                    res.status(404).json({ message: "Quotation not found!" });
                    return;
                }
            }

            const checkRef = await tx.quotations.findFirst({
                where: { 
                    branchId: Number(branchId),
                    ref: ref,
                    ...(quotationId && {
                        id: { not: Number(quotationId) }
                    })
                 },
            });

            if (checkRef) {
                res.status(400).json({ message: "Quotation # already exists!" });
                return;
            }

            // let ref = "QR-";

            // // Generate a new ref only for creation
            // if (!id) {
            //     // Query for the highest ref in the same branch
            //     const lastQuotation = await prisma.quotations.findFirst({
            //         where: { branchId: parseInt(branchId, 10) },
            //         orderBy: { id: 'desc' }, // Sort by ref in descending order
            //     });

            //     // Extract and increment the numeric part of the ref
            //     if (lastQuotation && lastQuotation.ref) {
            //         const refNumber = parseInt(lastQuotation.ref.split('-')[1], 10) || 0;
            //         ref += String(refNumber + 1).padStart(5, '0'); // Increment and format with leading zeros
            //     } else {
            //         ref += "00001"; // Start from 00001 if no ref exists for the branch
            //     }
            // }

            const quotation = quotationId
                ? await tx.quotations.update({
                    where: { id: Number(quotationId) },
                    data: {
                        ref,
                        branchId: parseInt(branchId, 10),
                        customerId: parseInt(customerId, 10),
                        quotationDate: new Date(dayjs(quotationDate).format("YYYY-MM-DD")),
                        QuoteSaleType,
                        taxRate,
                        taxNet,
                        discount,
                        shipping,
                        grandTotal,
                        status,
                        note,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null,
                        sentAt: status === "SENT" ? currentDate : null,
                        sentBy: status === "SENT" ? req.user ? req.user.id : null : null,
                        quotationDetails: {
                            deleteMany: { quotationId: Number(quotationId) },
                            create: await Promise.all(
                                quotationDetails.map(async (detail: any) => {
                                    // SERVICE
                                    if (detail.ItemType === "SERVICE") {
                                        return {
                                            ItemType: detail.ItemType,
                                            serviceId: detail.serviceId ? Number(detail.serviceId) : null,
                                            productId: null,
                                            productVariantId: null,

                                            // UOM empty for service
                                            unitId: null,
                                            unitQty: null,
                                            baseQty: null,

                                            cost: new Decimal(detail.cost ?? 0),
                                            costPerBaseUnit: new Decimal(detail.costPerBaseUnit ?? 0),
                                            taxNet: new Decimal(detail.taxNet ?? 0),
                                            taxMethod: detail.taxMethod,
                                            discount: new Decimal(detail.discount ?? 0),
                                            discountMethod: detail.discountMethod,
                                            total: new Decimal(detail.total ?? 0),
                                            quantity: Number(detail.quantity ?? 1),
                                        };
                                    }

                                    // PRODUCT
                                    const { unitId, unitQty, baseQty } = await computeBaseQty(tx, detail);

                                    return {
                                        ItemType: detail.ItemType,
                                        productId: detail.productId ? Number(detail.productId) : null,
                                        productVariantId: detail.productVariantId ? Number(detail.productVariantId) : null,
                                        serviceId: null,

                                        // ✅ save UOM
                                        unitId,
                                        unitQty,
                                        baseQty,

                                        cost: new Decimal(detail.cost ?? 0),
                                        costPerBaseUnit: new Decimal(detail.costPerBaseUnit ?? 0),
                                        taxNet: new Decimal(detail.taxNet ?? 0),
                                        taxMethod: detail.taxMethod,
                                        discount: new Decimal(detail.discount ?? 0),
                                        discountMethod: detail.discountMethod,
                                        total: new Decimal(detail.total ?? 0),

                                        // keep old field (optional)
                                        quantity: Number(detail.quantity ?? detail.unitQty ?? 0),
                                    };
                                })
                            ),
                        },
                    }
                })
                : await tx.quotations.create({
                    data: {
                        branchId: parseInt(branchId, 10),
                        customerId: parseInt(customerId, 10),
                        QuoteSaleType,
                        ref,
                        taxRate,
                        taxNet,
                        discount,
                        shipping,
                        grandTotal,
                        status,
                        note,
                        quotationDate: new Date(dayjs(quotationDate).format("YYYY-MM-DD")),
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null,
                        sentAt: status === "SENT" ? currentDate : null,
                        sentBy: status === "SENT" ? req.user ? req.user.id : null : null,
                        quotationDetails: {
                            create: await Promise.all(
                                quotationDetails.map(async (detail: any) => {
                                    if (detail.ItemType === "SERVICE") {
                                        return {
                                            ItemType: detail.ItemType,
                                            serviceId: detail.serviceId ? Number(detail.serviceId) : null,
                                            productId: null,
                                            productVariantId: null,
                                            unitId: null,
                                            unitQty: null,
                                            baseQty: null,
                                            cost: new Decimal(detail.cost ?? 0),
                                            costPerBaseUnit: new Decimal(detail.costPerBaseUnit ?? 0),
                                            taxNet: new Decimal(detail.taxNet ?? 0),
                                            taxMethod: detail.taxMethod,
                                            discount: new Decimal(detail.discount ?? 0),
                                            discountMethod: detail.discountMethod,
                                            total: new Decimal(detail.total ?? 0),
                                            quantity: Number(detail.quantity ?? 1),
                                        };
                                    }

                                    const { unitId, unitQty, baseQty } = await computeBaseQty(tx, detail);

                                    return {
                                        ItemType: detail.ItemType,
                                        productId: detail.productId ? Number(detail.productId) : null,
                                        productVariantId: detail.productVariantId ? Number(detail.productVariantId) : null,
                                        serviceId: null,

                                        unitId,
                                        unitQty,
                                        baseQty,

                                        cost: new Decimal(detail.cost ?? 0),
                                        costPerBaseUnit: new Decimal(detail.costPerBaseUnit ?? 0),
                                        taxNet: new Decimal(detail.taxNet ?? 0),
                                        taxMethod: detail.taxMethod,
                                        discount: new Decimal(detail.discount ?? 0),
                                        discountMethod: detail.discountMethod,
                                        total: new Decimal(detail.total ?? 0),
                                        quantity: Number(detail.quantity ?? detail.unitQty ?? 0),
                                    };
                                })
                            ),
                        },
                    }
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
              include: {
                baseUnit: { select: { id: true, name: true, type: true } },
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
    const quotationId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    try {
        const result = await prisma.$transaction(async (tx) => {
            /* ------------------------------------------------ */
            /* 1️ FETCH QUOTATION WITH DETAILS                  */
            /* ------------------------------------------------ */
            const quotation = await tx.quotations.findUnique({
                where: { id: Number(quotationId) },
                include: {
                    quotationDetails: {
                        include: {
                            productvariants: true
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

            /* ------------------------------------------------ */
            /* 2️ GENERATE ORDER REF                           */
            /* ------------------------------------------------ */
            // Query for the highest ref in the same branch
            const lastOrder = await tx.order.findFirst({
                where: { branchId: quotation.branchId },
                orderBy: { id: 'desc' }, // Sort by ref in descending order
            });

            let ref = "INV-";
            // Extract and increment the numeric part of the ref
            if (lastOrder && lastOrder.ref) {
                const refNumber = parseInt(lastOrder.ref.split('-')[1], 10) || 0;
                ref += String(refNumber + 1).padStart(5, '0'); // Increment and format with leading zeros
            } else {
                ref += "00001"; // Start from 00001 if no ref exists for the branch
            }

            /* ------------------------------------------------ */
            /* 3️ CREATE ORDER + ITEMS (RETURN ITEMS!)         */
            /* ------------------------------------------------ */
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
                    createdBy: req.user?.id ?? null,
                    createdAt: currentDate,
                    updatedAt: currentDate,
                    updatedBy: req.user?.id ?? null,
                    status: "APPROVED",

                    items: {
                        create: quotation.quotationDetails.map((item) => {
                            const base = {
                                ItemType: item.ItemType,
                                taxNet: Number(item.taxNet),
                                taxMethod: item.taxMethod,
                                discount: item.discount,
                                discountMethod: item.discountMethod,
                                total: Number(item.total),

                                // legacy
                                quantity: item.quantity,
                                price: Number(item.cost),

                                productVariantId: item.productVariantId,
                                productId: item.productId,
                                serviceId: item.serviceId,

                                // ✅ UOM copy
                                unitId: item.unitId,
                                unitQty: item.unitQty,
                                baseQty: item.baseQty,
                            };

                            return base;
                        }),
                    },
                },
                include: {
                    items: true,
                },
            });

            // Create a map of productVariantId to orderItemId for quick lookup, not from quotation details
            /* ------------------------------------------------ */
            /* 4️ MAP productVariantId → OrderItem.id          */
            /* ------------------------------------------------ */
            const orderItemMap = new Map<number, number>();

            for (const oi of order.items) {
                if (oi.productVariantId) {
                    orderItemMap.set(oi.productVariantId, oi.id);
                }
            }

            /* ------------------------------------------------ */
            /* 5️ CUT STOCK (FIFO)                             */
            /* ------------------------------------------------ */
            for (const qd of quotation.quotationDetails) {
                if (qd.ItemType !== "PRODUCT" || !qd.productVariantId) continue;

                const orderItemId = orderItemMap.get(qd.productVariantId);
                if (!orderItemId) {
                    throw new Error(
                        `OrderItem not found for productVariantId ${qd.productVariantId}`
                    );
                }

                const stock = await tx.stocks.findUnique({
                    where: {
                        productVariantId_branchId: {
                            productVariantId: qd.productVariantId,
                            branchId: quotation.branchId,
                        },
                    },
                });

                const sellBaseQty = qd.baseQty
                    ? new Decimal(qd.baseQty)
                    : new Decimal(qd.quantity ?? 0); // fallback for old records

                if (!stock || new Decimal(stock.quantity).lt(sellBaseQty)) {
                    throw new Error(`Insufficient stock for barcode: ${qd.productvariants?.barcode}`);
                }

                let qtyToSell = sellBaseQty;

                const fifoBatches = await tx.stockMovements.findMany({
                    where: {
                        productVariantId: qd.productVariantId,
                        branchId: quotation.branchId,
                        type: { in: ["PURCHASE", "RETURN", "ADJUSTMENT"] },
                        AdjustMentType: "POSITIVE",
                        status: "APPROVED",
                        remainingQty: { gt: 0 },
                    },
                    orderBy: { createdAt: "asc" },
                });

                for (const batch of fifoBatches) {
                    if (qtyToSell.lte(0)) break;

                    const consumeQty = Decimal.min(batch.remainingQty!, qtyToSell);

                    // CREATE ORDER STOCK MOVEMENT
                    await tx.stockMovements.create({
                        data: {
                            productVariantId: qd.productVariantId,
                            branchId: quotation.branchId,
                            orderItemId: orderItemId, // REAL ID
                            type: "ORDER",
                            status: "APPROVED",
                            quantity: consumeQty.neg(),
                            unitCost: batch.unitCost,
                            sourceMovementId: batch.id,
                            note: `Invoice #${ref}`,
                            createdBy: req.user?.id ?? null,
                            createdAt: currentDate,
                        },
                    });

                    // UPDATE FIFO BATCH
                    await tx.stockMovements.update({
                        where: { id: batch.id },
                        data: {
                            remainingQty: batch.remainingQty!.minus(consumeQty),
                        },
                    });

                    qtyToSell = qtyToSell.minus(consumeQty);
                }

                if (qtyToSell.gt(0)) {
                    throw new Error(
                        `Not enough FIFO stock for productVariantId ${qd.productVariantId}`
                    );
                }

                // UPDATE TOTAL STOCK
                await tx.stocks.update({
                    where: { id: stock.id },
                    data: {
                        quantity: { decrement: sellBaseQty }, // ✅ base unit
                        updatedAt: currentDate,
                        updatedBy: req.user?.id ?? null,
                    },
                });
            }

            /* ------------------------------------------------ */
            /* 6️ UPDATE QUOTATION STATUS                     */
            /* ------------------------------------------------ */
            await tx.quotations.update({
                where: { id: quotation.id },
                data: {
                    invoicedAt: currentDate,
                    invoicedBy: req.user?.id ?? null,
                    status: "INVOICED",
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