import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import logger from "../utils/logger";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { getQueryNumber, getQueryString } from "../utils/request";
import { Decimal } from "@prisma/client/runtime/library";
import { addReturnStockLayer, resolveReturnCostPerBaseUnit } from "../utils/addReturnStockLayer";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));


export const getAllStockReturns = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const rawSortField = getQueryString(req.query.sortField, "ref")!;
        const sortField = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawSortField) ? rawSortField : "ref";
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "asc" : "desc";
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
                 OR br."name" ILIKE $${idx + 2})
            `)
            .join(" AND ");

        // Build parameters: $1 = likeTerm, $2..$n = searchword, $n+1 = limit, $n+2 = offset
        const params = [likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // Branch restriction
        let branchRestriction = "";
        if (loggedInUser.roleType === "USER" && loggedInUser.branchId) {
            branchRestriction = `AND sr."branchId" = ${loggedInUser.branchId}`;
        }

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "StockReturns" sr
            LEFT JOIN "Branch" br ON sr."branchId" = br.id
            LEFT JOIN "User" c ON sr."createdBy" = c.id
            LEFT JOIN "User" u ON sr."updatedBy" = u.id
            LEFT JOIN "User" ab ON sr."approvedBy" = ab.id
            LEFT JOIN "User" rb ON sr."returnBy" = rb.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    sr."StatusType"::text ILIKE $1
                    OR rb."firstName" ILIKE $1
                    OR rb."lastName" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(sr."returnDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // ----- 2) DATA FETCH -----
        const stockAdjustment: any = await prisma.$queryRawUnsafe(`
            SELECT sr.*,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater,
                   json_build_object('id', ab.id, 'firstName', ab."firstName", 'lastName', ab."lastName") AS approver,
                   json_build_object('id', rb.id, 'firstName', rb."firstName", 'lastName', rb."lastName") AS returner
            FROM "StockReturns" sr
            LEFT JOIN "Branch" br ON sr."branchId" = br.id
            LEFT JOIN "User" c ON sr."createdBy" = c.id
            LEFT JOIN "User" u ON sr."updatedBy" = u.id
            LEFT JOIN "User" ab ON sr."approvedBy" = ab.id
            LEFT JOIN "User" rb ON sr."returnBy" = rb.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    sr."StatusType"::text ILIKE $1
                    OR rb."firstName" ILIKE $1
                    OR rb."lastName" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(sr."returnDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."approvedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(sr."approvedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY sr."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: stockAdjustment, total });

    } catch (error) {
        console.error("Error fetching stock return:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const upsertReturn = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { branchId, StatusType, note, returnDetails, returnDate } = req.body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const loggedInUser = req.user;
      const currentDate = new Date();

      if (!loggedInUser) {
        res.status(401).json({ message: "User is not authenticated." });
        return;
      }

      const returnId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

      let oldReturn: any = null;

      if (returnId) {
        oldReturn = await tx.stockReturns.findUnique({
          where: { id: returnId },
          include: {
            returnDetails: true,
          },
        });

        if (!oldReturn) {
          res.status(404).json({ message: "Stock return not found!" });
          return;
        }

        if (oldReturn.StatusType === "APPROVED") {
          throw new Error("Approved stock return cannot be edited.");
        }

        if (oldReturn.StatusType === "CANCELLED") {
          throw new Error("Cancelled stock return cannot be edited.");
        }
      }

      if (!branchId || Number(branchId) <= 0) {
        throw new Error("branchId is required");
      }

      if (!returnDate) {
        throw new Error("returnDate is required");
      }

      if (!returnDetails || !Array.isArray(returnDetails) || returnDetails.length === 0) {
        throw new Error("Return details cannot be empty");
      }

      for (const detail of returnDetails) {
        if (!detail.productVariantId) {
          throw new Error("productVariantId is required in return details");
        }

        if (!detail.unitId) {
          throw new Error("unitId is required in return details");
        }

        if (detail.unitQty == null || Number(detail.unitQty) <= 0) {
          throw new Error("unitQty must be greater than 0");
        }

        if (detail.baseQty == null || Number(detail.baseQty) <= 0) {
          throw new Error("baseQty must be greater than 0");
        }
      }

      let ref = oldReturn?.ref ?? "SRT-00001";

      if (!returnId) {
        const lastReturn = await tx.stockReturns.findFirst({
          where: { branchId: Number(branchId) },
          orderBy: { id: "desc" },
          select: { ref: true },
        });

        if (lastReturn?.ref) {
          const refNumber = parseInt(lastReturn.ref.split("-")[1], 10) || 0;
          ref = `SRT-${String(refNumber + 1).padStart(5, "0")}`;
        }
      }

      const normalizedStatus = StatusType === "APPROVED" ? "APPROVED" : "PENDING";

      const detailCreates: Prisma.ReturnDetailsUncheckedCreateWithoutStockreturnsInput[] =
        returnDetails.map((detail: any) => ({
          productId: detail.productId ? Number(detail.productId) : null,
          productVariantId: Number(detail.productVariantId),
          unitId: Number(detail.unitId),
          unitQty: new Decimal(detail.unitQty ?? 0),
          baseQty: new Decimal(detail.baseQty ?? 0),
          quantity: Math.round(Number(detail.baseQty ?? 0)),

          // frontend does not send cost now
          cost: null,
          costPerBaseUnit: null,
        }));

      const basePayload = {
        branchId: Number(branchId),
        returnBy: loggedInUser.id,
        returnDate: dayjs(returnDate).startOf("day").toDate(),
        StatusType: normalizedStatus as any,
        note: note ?? null,
        updatedAt: currentDate,
        updatedBy: loggedInUser.id,
      };

      const updateData: Prisma.StockReturnsUncheckedUpdateInput = {
        ...basePayload,
        returnDetails: {
          deleteMany: { returnId },
          create: detailCreates,
        },
      };

      const createData: Prisma.StockReturnsUncheckedCreateInput = {
        ...basePayload,
        ref,
        createdAt: currentDate,
        createdBy: loggedInUser.id,
        returnDetails: {
          create: detailCreates,
        },
      };

      const returnData = returnId
        ? await tx.stockReturns.update({
            where: { id: returnId },
            data: updateData,
            include: {
              returnDetails: true,
            },
          })
        : await tx.stockReturns.create({
            data: createData,
            include: {
              returnDetails: true,
            },
          });

      if (normalizedStatus === "APPROVED") {
        for (const detail of returnData.returnDetails) {
          const baseQty = new Decimal(detail.baseQty ?? 0);

          if (baseQty.lte(0)) {
            throw new Error("baseQty must be greater than 0");
          }

          const costPerBaseUnit = await resolveReturnCostPerBaseUnit({
            tx,
            productVariantId: Number(detail.productVariantId),
            branchId: Number(branchId),
          });

          const operationValue = Number(detail.baseQty ?? 0) > 0 && Number(detail.unitQty ?? 0) > 0
            ? Number(detail.baseQty) / Number(detail.unitQty)
            : 1;

          const cost = costPerBaseUnit.mul(new Decimal(operationValue || 1));

          await tx.returnDetails.update({
            where: { id: detail.id },
            data: {
              cost,
              costPerBaseUnit,
            },
          });

          await tx.stocks.upsert({
            where: {
              productVariantId_branchId: {
                productVariantId: Number(detail.productVariantId),
                branchId: Number(branchId),
              },
            },
            update: {
              quantity: { increment: baseQty },
              updatedBy: loggedInUser.id,
              updatedAt: currentDate,
            },
            create: {
              productVariantId: Number(detail.productVariantId),
              branchId: Number(branchId),
              quantity: baseQty,
              createdBy: loggedInUser.id,
              createdAt: currentDate,
              updatedBy: loggedInUser.id,
              updatedAt: currentDate,
            },
          });

          await addReturnStockLayer({
            tx,
            productVariantId: Number(detail.productVariantId),
            branchId: Number(branchId),
            qtyToAdd: baseQty,
            unitCost: costPerBaseUnit,
            userId: loggedInUser.id,
            currentDate,
            note: note || `Stock return #${returnData.ref}`,
            returnDetailId: detail.id,
          });
        }

        await tx.stockReturns.update({
          where: { id: returnData.id },
          data: {
            StatusType: "APPROVED",
            approvedAt: currentDate,
            approvedBy: loggedInUser.id,
          },
        });
      }

      return await tx.stockReturns.findUnique({
        where: { id: returnData.id },
        include: {
          returnDetails: true,
        },
      });
    });

    if (!result) return;
    res.status(id ? 200 : 201).json(result);
  } catch (error) {
    logger.error("Error creating/updating stock return:", error);
    const typedError = error as Error;
    res.status(500).json({ message: typedError.message });
  }
};

export const getStockReturnById = async (
    req: Request,
    res: Response
): Promise<void> => {
    const { id } = req.params;

    const stockReturnId = id ? (Array.isArray(id) ? id[0] : id) : 0;

    try {
        const purchase = await prisma.stockReturns.findUnique({
            where: { id: Number(stockReturnId) },
            include: {
                branch: true,
                creator: true,
                updater: true,
                returnDetails: {
                    include: {
                        unit: true,
                        products: true,
                        productvariants: {
                            select: {
                                id: true,
                                productId: true,
                                name: true,
                                barcode: true,
                                sku: true,
                                productType: true,
                                baseUnitId: true,
                                baseUnit: {
                                    select: {
                                        id: true,
                                        name: true,
                                        type: true,
                                    },
                                },
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
                                                fromUnit: {
                                                    select: {
                                                        id: true,
                                                        name: true,
                                                        type: true,
                                                    },
                                                },
                                                toUnit: {
                                                    select: {
                                                        id: true,
                                                        name: true,
                                                        type: true,
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!purchase) {
            res.status(404).json({ message: "Stock adjustment not found!" });
            return;
        }

        const branchId = purchase.branchId;

        const variantIds = purchase.returnDetails
            .map((detail) => detail.productVariantId)
            .filter((id): id is number => id !== null);

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

        const stockMap = new Map<number, number>(
            stocks.map((s) => [s.productVariantId, Number(s.quantity)])
        );

        purchase.returnDetails = purchase.returnDetails.map((detail: any) => {
            const pv = detail.productvariants;

            let unitOptions: any[] = [];

            if (pv) {
                const unitMap = new Map<
                    number,
                    {
                        unitId: number;
                        unitName: string;
                        operationValue: number;
                        isBaseUnit: boolean;
                        operator?: string;
                    }
                >();

                if (pv.baseUnit) {
                    unitMap.set(pv.baseUnit.id, {
                        unitId: pv.baseUnit.id,
                        unitName: pv.baseUnit.name,
                        operationValue: 1,
                        isBaseUnit: true,
                        operator: "*",
                    });
                }

                const conversions = pv.products?.unitConversions ?? [];

                for (const conv of conversions) {
                    if (pv.baseUnitId === conv.toUnitId && conv.fromUnit) {
                        unitMap.set(conv.fromUnit.id, {
                            unitId: conv.fromUnit.id,
                            unitName: conv.fromUnit.name,
                            operationValue: Number(conv.multiplier ?? 1),
                            isBaseUnit: false,
                            operator: "*",
                        });
                    }

                    if (pv.baseUnitId === conv.fromUnitId && conv.toUnit) {
                        const multiplier = Number(conv.multiplier ?? 1);

                        unitMap.set(conv.toUnit.id, {
                            unitId: conv.toUnit.id,
                            unitName: conv.toUnit.name,
                            operationValue: multiplier === 0 ? 1 : 1 / multiplier,
                            isBaseUnit: false,
                            operator: "*",
                        });
                    }
                }

                unitOptions = Array.from(unitMap.values());
            }

            return {
                ...detail,
                productvariants: pv
                    ? {
                          ...pv,
                          unitOptions,
                      }
                    : null,
                name: detail.productvariants?.name,
                barcode: detail.productvariants?.barcode,
                sku: detail.productvariants?.sku,
                stocks: stockMap.get(detail.productVariantId) ?? 0,
            };
        });

        res.status(200).json(purchase);
    } catch (error) {
        console.error("Error fetching return by ID:", error);
        res.status(500).json({
            message: "Error fetching return by ID",
        });
    }
};

// export const getStockReturnById = async (req: Request, res: Response): Promise<void> => {
//     const { id } = req.params;
//     const stockReturnId = id ? (Array.isArray(id) ? id[0] : id) : 0;
//     try {
//         const returnData = await prisma.stockReturns.findUnique({
//             where: { id: Number(stockReturnId) },
//             include: { 
//                 returnDetails: {
//                     include: {
//                         products: true, // Include related products data
//                         productvariants: {
//                             select: {
//                                 name: true, // Select the `name` field from `productVariant`
//                                 barcode: true,
//                                 sku: true
//                             },
//                         },
//                     },
//                 },
//                 branch: true, // Include related branch data
//             },
//         });

//         // Transform data to flatten `name` into `requestDetails`
//         if (returnData) {
//             returnData.returnDetails = returnData.returnDetails.map((detail: any) => ({
//                 ...detail,
//                 name: detail.productvariants.name, // Add `name` directly
//             }));
//         }

//         if (!returnData) {
//             res.status(404).json({ message: "Stock return not found!" });
//             return;
//         }
//         res.status(200).json(returnData);
//     } catch (error) {
//         logger.error("Error fetching stock return by ID:", error);
//         const typedError = error as Error;
//         res.status(500).json({ message: typedError.message });
//     }
// };

export const deleteReturn = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const stockReturnId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    const { delReason } = req.body;
    try {
        const returnData = await prisma.stockReturns.findUnique({ 
            where: { id: Number(stockReturnId) },
            include: { returnDetails: true } 
        });
        if (!returnData) {
            res.status(404).json({ message: "Stock return not found!" });
            return;
        }
        await prisma.stockReturns.update({
            where: { id: Number(stockReturnId) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason,
                StatusType: "CANCELLED"
            }
        });
        res.status(200).json(returnData);
    } catch (error) {
        logger.error("Error deleting stock return:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};