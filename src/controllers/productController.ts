import { NextFunction, Request, Response } from "express";
import { Decimal } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import multer from "multer";
import fs from "fs"; // Import fs module to delete files
import path from "path";
import logger from "../utils/logger";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { getQueryNumber, getQueryString } from "../utils/request";
import { addPositiveAdjustmentLayer, consumeFifoForNegativeAdjustment, resolveCostPerBaseUnit } from "../utils/consumeFifoForAdjustment";
import { prisma } from "../lib/prisma";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

export const getAllProducts = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const rawSortField = getQueryString(req.query.sortField, "name")!;
        const sortField = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawSortField) ? rawSortField : "name";
        const sortOrder = getQueryString(req.query.sortOrder)?.toLowerCase() === "desc" ? "DESC" : "ASC";
        const offset = (pageNumber - 1) * pageSize;

        // Base LIKE term
        const likeTerm = `%${searchTerm}%`;

        // Split searchTerm into words → e.g. "Lorn Titya"
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        // creator/updater multi-word name search
        const fullNameConditions = searchWords
            .map((_, idx) => `
                (
                    cr."firstName" ILIKE $${idx + 2} OR cr."lastName" ILIKE $${idx + 2}
                    OR up."firstName" ILIKE $${idx + 2} OR up."lastName" ILIKE $${idx + 2}
                )
            `)
            .join(" AND ");

        // Build params dynamically
        const params = [likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // 1️ Count total
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Products" p
            LEFT JOIN "Categories" c ON p."categoryId" = c.id
            LEFT JOIN "Brands" b ON p."brandId" = b.id
            LEFT JOIN "User" cr ON p."createdBy" = cr.id
            LEFT JOIN "User" up ON p."updatedBy" = up.id
            WHERE p."deletedAt" IS NULL
            AND (
                p."name" ILIKE $1
                OR c."name" ILIKE $1
                OR b."en_name" ILIKE $1
                OR b."kh_name" ILIKE $1
                OR TO_CHAR(p."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(p."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(p."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(p."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated products
        const products: any = await prisma.$queryRawUnsafe(`
            SELECT 
                p.*,
                json_build_object('id', c.id, 'name', c."name") AS category,
                json_build_object('id', b.id, 'en_name', b."en_name", 'kh_name', b."kh_name") AS brand,
                json_build_object('id', cr.id, 'firstName', cr."firstName", 'lastName', cr."lastName") AS creator,
                json_build_object('id', up.id, 'firstName', up."firstName", 'lastName', up."lastName") AS updater
            FROM "Products" p
            LEFT JOIN "Categories" c ON p."categoryId" = c.id
            LEFT JOIN "Brands" b ON p."brandId" = b.id
            LEFT JOIN "User" cr ON p."createdBy" = cr.id
            LEFT JOIN "User" up ON p."updatedBy" = up.id
            WHERE p."deletedAt" IS NULL
            AND (
                p."name" ILIKE $1
                OR c."name" ILIKE $1
                OR b."en_name" ILIKE $1
                OR b."kh_name" ILIKE $1
                OR TO_CHAR(p."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(p."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(p."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(p."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
            ORDER BY p."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: products, total });

    } catch (error) {
        logger.error("Error fetching products:", error);
        res.status(500).json({ message: (error as Error).message });
    }
};

// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/images/products/");
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        const uniqueName = `${uniqueSuffix}${fileExtension}`;
        cb(null, uniqueName);
    }
});

export const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // const productId = req.params.id ? parseInt(req.params.id, 10) : undefined;

    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
        return cb(new Error("Invalid file type. Only JPG, PNG, WEBP, GIF, and SVG are allowed."));
    }

    // Check for file size here as well (besides multer's built-in fileSize limit)
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_FILE_SIZE) {
        return cb(new multer.MulterError('LIMIT_FILE_SIZE', 'File is too large')); // Explicitly reject file
    }

    const filePath = path.join("public/images/products/", file.originalname);

    if (fs.existsSync(filePath)) {
        logger.info(`File ${file.originalname} already exists in the directory. Skipping upload.`);
        return cb(null, false); // Reject upload
    }

    cb(null, true); // Accept upload
};

export const uploadImage = (req: Request, res: Response, next: NextFunction) => {
    const upload = multer({
        storage: storage,
        fileFilter: fileFilter,
        limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5 MB
    }).array("images[]", 10); // Limit to 10 images

    upload(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
                return res.status(400).json({ message: "File too large. Maximum size is 5 MB." });
            }
            return res.status(400).json({ message: `Multer error: ${err.message}` });
        } else if (err) {
            return res.status(500).json({ message: `Unexpected error: ${err.message}` });
        }
        next(); // Proceed to the next middleware
    });
};

const normalizeMac = (value?: string | null): string | null => {
  if (!value) return null;
  const normalized = value.replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
  return normalized || null;
};

const groupTrackedItemsToStocks = (
  trackedItems: {
    branchId: number;
    assetCode?: string | null;
    macAddress?: string | null;
    serialNumber?: string | null;
  }[]
) => {
  const grouped: Record<number, number> = {};

  for (const item of trackedItems) {
    if (!item.branchId) continue;
    grouped[item.branchId] = (grouped[item.branchId] || 0) + 1;
  }

  return Object.entries(grouped).map(([branchId, quantity]) => ({
    branchId: Number(branchId),
    quantity,
  }));
};

const validateTrackedItems = (
  trackedItems: {
    id?: number;
    branchId: number;
    assetCode?: string | null;
    macAddress?: string | null;
    serialNumber?: string | null;
  }[]
) => {
  const assetSet = new Set<string>();
  const macSet = new Set<string>();
  const serialSet = new Set<string>();

  const cleaned = trackedItems
    .map((item) => ({
      id: item.id ? Number(item.id) : undefined,
      branchId: Number(item.branchId || 0),
      assetCode: item.assetCode?.trim() || null,
      macAddress: normalizeMac(item.macAddress),
      serialNumber: item.serialNumber?.trim() || null,
    }))
    .filter((item) => item.branchId);

  for (const item of cleaned) {
    if (!item.serialNumber) {
      throw new Error("Serial Number is required for every tracked item");
    }

    const serialKey = item.serialNumber.toUpperCase();
    if (serialSet.has(serialKey)) {
      throw new Error(`Duplicate Serial Number: ${item.serialNumber}`);
    }
    serialSet.add(serialKey);

    if (item.assetCode) {
      const assetKey = item.assetCode.toUpperCase();
      if (assetSet.has(assetKey)) {
        throw new Error(`Duplicate Asset Code: ${item.assetCode}`);
      }
      assetSet.add(assetKey);
    }

    if (item.macAddress) {
      if (macSet.has(item.macAddress)) {
        throw new Error(`Duplicate MAC Address: ${item.macAddress}`);
      }
      macSet.add(item.macAddress);
    }
  }

  return cleaned;
};

// export const upsertProduct = async (req: Request, res: Response): Promise<void> => {
//   const { id } = req.params;

//   const {
//     productType,
//     categoryId,
//     brandId,
//     name,
//     note,
//     isActive,
//     imagesToDelete,

//     unitId,
//     baseUnitId,
//     unitConversions,

//     barcode,
//     sku,
//     stockAlert,

//     purchasePrice,
//     purchasePriceUnitId,

//     retailPrice,
//     retailPriceUnitId,
//     wholeSalePrice,
//     wholeSalePriceUnitId,

//     variantValueIds,
//     stocks,
//     updateStock,
//   } = req.body;

//   const shouldUpdateStock =
//     updateStock === true ||
//     updateStock === "true" ||
//     updateStock === 1 ||
//     updateStock === "1";

//   const imagePaths = req.files
//     ? (req.files as Express.Multer.File[]).map((file) =>
//         file.path.replace(/^public[\\/]/, "")
//       )
//     : [];

//   let parsedVariantValueIds: number[] = [];
//   if (typeof variantValueIds === "string") {
//     parsedVariantValueIds = JSON.parse(variantValueIds);
//   } else if (Array.isArray(variantValueIds)) {
//     parsedVariantValueIds = variantValueIds.map(Number);
//   }

//   let parsedStocks: { branchId: number; quantity: number }[] = [];
//   if (shouldUpdateStock) {
//     if (typeof stocks === "string") {
//       parsedStocks = JSON.parse(stocks);
//     } else if (Array.isArray(stocks)) {
//       parsedStocks = stocks.map((s: any) => ({
//         branchId: Number(s.branchId),
//         quantity: Number(s.quantity),
//       }));
//     }
//   }

//   let parsedConversions: {
//     fromUnitId: number;
//     toUnitId: number;
//     multiplier: number;
//   }[] = [];

//   if (typeof unitConversions === "string") {
//     parsedConversions = JSON.parse(unitConversions);
//   } else if (Array.isArray(unitConversions)) {
//     parsedConversions = unitConversions.map((c: any) => ({
//       fromUnitId: Number(c.fromUnitId),
//       toUnitId: Number(c.toUnitId),
//       multiplier: Number(c.multiplier),
//     }));
//   }

//   try {
//     if (!baseUnitId) {
//       throw new Error("Base unit is required");
//     }

//     const parsedBaseUnitId = Number(baseUnitId);
//     if (isNaN(parsedBaseUnitId)) {
//       throw new Error("Invalid base unit");
//     }

//     if (!purchasePriceUnitId) {
//       throw new Error("Opening cost unit is required");
//     }

//     if (!retailPriceUnitId) {
//       throw new Error("Retail price unit is required");
//     }

//     if (!wholeSalePriceUnitId) {
//       throw new Error("Wholesale price unit is required");
//     }

//     const result = await prisma.$transaction(async (tx) => {
//       const productId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

//       const existingProduct = await tx.products.findFirst({
//         where: { name, id: { not: productId || 0 } },
//       });

//       if (existingProduct) {
//         throw new Error("Product's name must be unique");
//       }

//       let existingImages: string[] = [];
//       if (productId) {
//         const checkProduct = await tx.products.findUnique({
//           where: { id: productId },
//         });
//         if (!checkProduct) throw new Error("Product not found");
//         existingImages = checkProduct.image || [];
//       }

//       const parsedImagesToDelete =
//         typeof imagesToDelete === "string"
//           ? JSON.parse(imagesToDelete)
//           : imagesToDelete;

//       if (Array.isArray(parsedImagesToDelete)) {
//         parsedImagesToDelete.forEach((imagePath: string) => {
//           const fullPath = `public/${imagePath}`;
//           if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
//         });

//         existingImages = existingImages.filter(
//           (img) => !parsedImagesToDelete.includes(img)
//         );
//       }

//       const updatedImages = [...existingImages, ...imagePaths];

//       const productData = {
//         categoryId: Number(categoryId),
//         brandId: Number(brandId),
//         name,
//         note,
//         isActive: Number(isActive ?? 1),
//         image: updatedImages,
//         updatedAt: currentDate,
//         updatedBy: req.user?.id || null,
//       };

//       const product = productId
//         ? await tx.products.update({
//             where: { id: productId },
//             data: productData,
//           })
//         : await tx.products.create({
//             data: {
//               ...productData,
//               createdAt: currentDate,
//               createdBy: req.user?.id || null,
//             },
//           });

//       await tx.productUnitConversion.deleteMany({
//         where: { productId: product.id },
//       });

//       if (parsedConversions.length > 0) {
//         if (parsedConversions.some((c) => !c.multiplier || c.multiplier <= 0)) {
//           throw new Error("UOM multiplier must be > 0");
//         }

//         if (parsedConversions.some((c) => c.fromUnitId === c.toUnitId)) {
//           throw new Error("UOM conversion cannot be same unit");
//         }

//         await tx.productUnitConversion.createMany({
//           data: parsedConversions.map((c) => ({
//             productId: product.id,
//             fromUnitId: c.fromUnitId,
//             toUnitId: c.toUnitId,
//             multiplier: c.multiplier,
//           })),
//         });
//       }

//       const existingVariant = await tx.productVariants.findFirst({
//         where: { productId: product.id },
//       });

//       const variantData = {
//         productId: product.id,
//         unitId: parsedBaseUnitId,
//         baseUnitId: parsedBaseUnitId,

//         sku,
//         stockAlert: Number(stockAlert ?? 0),
//         barcode,
//         productType,
//         name,

//         purchasePrice: Number(purchasePrice ?? 0),
//         purchasePriceUnitId: Number(purchasePriceUnitId),

//         retailPrice: Number(retailPrice ?? 0),
//         retailPriceUnitId: Number(retailPriceUnitId),

//         wholeSalePrice: Number(wholeSalePrice ?? 0),
//         wholeSalePriceUnitId: Number(wholeSalePriceUnitId),

//         image: updatedImages,
//         updatedAt: currentDate,
//         updatedBy: req.user?.id || null,
//       };

//       let variantId: number;

//       try {
//         if (existingVariant) {
//           const updatedVariant = await tx.productVariants.update({
//             where: { id: existingVariant.id },
//             data: variantData,
//           });
//           variantId = updatedVariant.id;

//           await tx.productVariantValues.deleteMany({
//             where: { productVariantId: variantId },
//           });
//         } else {
//           const newVariant = await tx.productVariants.create({
//             data: {
//               ...variantData,
//               isActive: 1,
//               createdAt: currentDate,
//               createdBy: req.user?.id || null,
//             },
//           });
//           variantId = newVariant.id;
//         }
//       } catch (error: any) {
//         if (error.code === "P2002") {
//           const target = error.meta?.target;
//           if (target?.includes("sku")) {
//             throw new Error("SKU already exists for this product type");
//           }
//           if (target?.includes("barcode")) {
//             throw new Error("Barcode already exists for this product type");
//           }
//         }
//         throw error;
//       }

//       if (parsedVariantValueIds.length > 0) {
//         await tx.productVariantValues.createMany({
//           data: parsedVariantValueIds.map((vId) => ({
//             productVariantId: variantId,
//             variantValueId: vId,
//           })),
//         });
//       }

//       if (shouldUpdateStock) {
//         const openingUnitCost = await resolveCostPerBaseUnit(
//           tx,
//           product.id,
//           parsedBaseUnitId,
//           purchasePrice ?? 0,
//           purchasePriceUnitId ?? null
//         );

//         for (const stock of parsedStocks) {
//           if (!stock.branchId) continue;

//           const branchIdNum = Number(stock.branchId);
//           const newQty = new Decimal(stock.quantity ?? 0);

//           const existingStock = await tx.stocks.findUnique({
//             where: {
//               productVariantId_branchId: {
//                 productVariantId: variantId,
//                 branchId: branchIdNum,
//               },
//             },
//           });

//           const oldQty = existingStock?.quantity ?? new Decimal(0);
//           const diffQty = newQty.minus(oldQty);

//           const note = productId
//             ? `Product stock adjusted from ${oldQty.toString()} to ${newQty.toString()} from product form: ${name}`
//             : `Opening stock from product form: ${name}`;

//           if (!existingStock) {
//             await tx.stocks.create({
//               data: {
//                 productVariantId: variantId,
//                 branchId: branchIdNum,
//                 quantity: newQty,
//                 createdBy: req.user?.id || null,
//                 createdAt: currentDate,
//                 updatedBy: req.user?.id || null,
//                 updatedAt: currentDate,
//               },
//             });

//             if (newQty.gt(0)) {
//               await addPositiveAdjustmentLayer({
//                 tx,
//                 productVariantId: variantId,
//                 branchId: branchIdNum,
//                 qtyToAdd: newQty,
//                 unitCost: openingUnitCost,
//                 userId: req.user?.id || null,
//                 currentDate,
//                 note,
//               });
//             }

//             continue;
//           }

//           if (diffQty.eq(0)) {
//             await tx.stocks.update({
//               where: { id: existingStock.id },
//               data: {
//                 updatedBy: req.user?.id || null,
//                 updatedAt: currentDate,
//               },
//             });
//             continue;
//           }

//           if (diffQty.gt(0)) {
//             await tx.stocks.update({
//               where: { id: existingStock.id },
//               data: {
//                 quantity: newQty,
//                 updatedBy: req.user?.id || null,
//                 updatedAt: currentDate,
//               },
//             });

//             await addPositiveAdjustmentLayer({
//               tx,
//               productVariantId: variantId,
//               branchId: branchIdNum,
//               qtyToAdd: diffQty,
//               unitCost: openingUnitCost,
//               userId: req.user?.id || null,
//               currentDate,
//               note,
//             });
//           } else {
//             const reduceQty = diffQty.abs();

//             if (oldQty.lt(reduceQty)) {
//               throw new Error(`Cannot reduce stock below zero for branch ${branchIdNum}`);
//             }

//             await consumeFifoForNegativeAdjustment({
//               tx,
//               productVariantId: variantId,
//               branchId: branchIdNum,
//               qtyToReduce: reduceQty,
//               userId: req.user?.id || null,
//               currentDate,
//               note,
//             });

//             await tx.stocks.update({
//               where: { id: existingStock.id },
//               data: {
//                 quantity: newQty,
//                 updatedBy: req.user?.id || null,
//                 updatedAt: currentDate,
//               },
//             });
//           }
//         }
//       }

//       return product;
//     });

//     res.status(id ? 200 : 201).json(result);
//   } catch (error: any) {
//     logger.error("Error upserting product:", error);
//     res.status(500).json({ message: error.message });
//   }
// };

export const upsertProduct = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const {
    productType,
    categoryId,
    brandId,
    name,
    note,
    isActive,
    imagesToDelete,

    unitId,
    baseUnitId,
    unitConversions,

    barcode,
    sku,
    stockAlert,

    purchasePrice,
    purchasePriceUnitId,

    retailPrice,
    retailPriceUnitId,
    wholeSalePrice,
    wholeSalePriceUnitId,

    variantValueIds,
    stocks,
    updateStock,

    trackingType,
    trackedItems,
  } = req.body;

  const shouldUpdateStock =
    updateStock === true ||
    updateStock === "true" ||
    updateStock === 1 ||
    updateStock === "1";

  const parsedTrackingType =
    trackingType === "ASSET_ONLY" ||
    trackingType === "MAC_ONLY" ||
    trackingType === "ASSET_AND_MAC"
      ? trackingType
      : "NONE";

  const imagePaths = req.files
    ? (req.files as Express.Multer.File[]).map((file) =>
        file.path.replace(/^public[\\/]/, "")
      )
    : [];

  let parsedVariantValueIds: number[] = [];
  if (typeof variantValueIds === "string") {
    parsedVariantValueIds = JSON.parse(variantValueIds);
  } else if (Array.isArray(variantValueIds)) {
    parsedVariantValueIds = variantValueIds.map(Number);
  }

  let parsedStocks: { branchId: number; quantity: number }[] = [];
  if (shouldUpdateStock) {
    if (typeof stocks === "string") {
      parsedStocks = JSON.parse(stocks);
    } else if (Array.isArray(stocks)) {
      parsedStocks = stocks.map((s: any) => ({
        branchId: Number(s.branchId),
        quantity: Number(s.quantity),
      }));
    }
  }

  let parsedTrackedItems: {
    id?: number;
    branchId: number;
    assetCode?: string | null;
    macAddress?: string | null;
    serialNumber?: string | null;
  }[] = [];

  if (shouldUpdateStock) {
    if (typeof trackedItems === "string") {
      const raw = JSON.parse(trackedItems);
      parsedTrackedItems = Array.isArray(raw)
        ? raw.map((x: any) => ({
            id: x.id ? Number(x.id) : undefined,
            branchId: Number(x.branchId),
            assetCode: x.assetCode?.trim() || null,
            macAddress: x.macAddress || null,
            serialNumber: x.serialNumber?.trim() || null,
          }))
        : [];
    } else if (Array.isArray(trackedItems)) {
      parsedTrackedItems = trackedItems.map((x: any) => ({
        id: x.id ? Number(x.id) : undefined,
        branchId: Number(x.branchId),
        assetCode: x.assetCode?.trim() || null,
        macAddress: x.macAddress || null,
        serialNumber: x.serialNumber?.trim() || null,
      }));
    }
  }

  let parsedConversions: {
    fromUnitId: number;
    toUnitId: number;
    multiplier: number;
  }[] = [];

  if (typeof unitConversions === "string") {
    parsedConversions = JSON.parse(unitConversions);
  } else if (Array.isArray(unitConversions)) {
    parsedConversions = unitConversions.map((c: any) => ({
      fromUnitId: Number(c.fromUnitId),
      toUnitId: Number(c.toUnitId),
      multiplier: Number(c.multiplier),
    }));
  }

  try {
    if (!baseUnitId) {
      throw new Error("Base unit is required");
    }

    const parsedBaseUnitId = Number(baseUnitId);
    if (isNaN(parsedBaseUnitId)) {
      throw new Error("Invalid base unit");
    }

    if (!purchasePriceUnitId) {
      throw new Error("Opening cost unit is required");
    }

    if (!retailPriceUnitId) {
      throw new Error("Retail price unit is required");
    }

    if (!wholeSalePriceUnitId) {
      throw new Error("Wholesale price unit is required");
    }

    const result = await prisma.$transaction(async (tx) => {
      const productId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

      // Block same name + same productType across all products
      const duplicateVariant = await tx.productVariants.findFirst({
        where: {
          productType,
          productId: { not: productId || 0 },
          products: { name },
        },
      });

      if (duplicateVariant) {
        throw new Error(`A ${productType} product with this name already exists`);
      }

      let existingImages: string[] = [];
      if (productId) {
        const checkProduct = await tx.products.findUnique({ where: { id: productId } });
        if (!checkProduct) throw new Error("Product not found");
        existingImages = checkProduct.image || [];
      }

      const parsedImagesToDelete =
        typeof imagesToDelete === "string"
          ? JSON.parse(imagesToDelete)
          : imagesToDelete;

      if (Array.isArray(parsedImagesToDelete)) {
        parsedImagesToDelete.forEach((imagePath: string) => {
          const fullPath = `public/${imagePath}`;
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        });
        existingImages = existingImages.filter(
          (img) => !parsedImagesToDelete.includes(img)
        );
      }

      const updatedImages = [...existingImages, ...imagePaths];

      const productData = {
        categoryId: Number(categoryId),
        brandId: Number(brandId),
        name,
        note,
        isActive: Number(isActive ?? 1),
        image: updatedImages,
        updatedAt: currentDate,
        updatedBy: req.user?.id || null,
      };

      const product = productId
        ? await tx.products.update({ where: { id: productId }, data: productData })
        : await tx.products.create({
            data: { ...productData, createdAt: currentDate, createdBy: req.user?.id || null },
          });

      await tx.productUnitConversion.deleteMany({ where: { productId: product.id } });

      if (parsedConversions.length > 0) {
        if (parsedConversions.some((c) => !c.multiplier || c.multiplier <= 0)) {
          throw new Error("UOM multiplier must be > 0");
        }

        if (parsedConversions.some((c) => c.fromUnitId === c.toUnitId)) {
          throw new Error("UOM conversion cannot be same unit");
        }

        await tx.productUnitConversion.createMany({
          data: parsedConversions.map((c) => ({
            productId: product.id,
            fromUnitId: c.fromUnitId,
            toUnitId: c.toUnitId,
            multiplier: c.multiplier,
          })),
        });
      }

      const existingVariant = await tx.productVariants.findFirst({
        where: { productId: product.id },
      });

      const variantData = {
        productId: product.id,
        unitId: parsedBaseUnitId,
        baseUnitId: parsedBaseUnitId,

        sku,
        stockAlert: Number(stockAlert ?? 0),
        barcode,
        productType,
        name,

        purchasePrice: Number(purchasePrice ?? 0),
        purchasePriceUnitId: Number(purchasePriceUnitId),

        retailPrice: Number(retailPrice ?? 0),
        retailPriceUnitId: Number(retailPriceUnitId),

        wholeSalePrice: Number(wholeSalePrice ?? 0),
        wholeSalePriceUnitId: Number(wholeSalePriceUnitId),

        trackingType: parsedTrackingType,

        image: updatedImages,
        updatedAt: currentDate,
        updatedBy: req.user?.id || null,
      };

      let variantId: number;

      try {
        if (existingVariant) {
          const updatedVariant = await tx.productVariants.update({
            where: { id: existingVariant.id },
            data: variantData,
          });
          variantId = updatedVariant.id;

          await tx.productVariantValues.deleteMany({
            where: { productVariantId: variantId },
          });
        } else {
          const newVariant = await tx.productVariants.create({
            data: {
              ...variantData,
              isActive: 1,
              createdAt: currentDate,
              createdBy: req.user?.id || null,
            },
          });
          variantId = newVariant.id;
        }
      } catch (error: any) {
        if (error.code === "P2002") {
          const target = error.meta?.target;
          if (target?.includes("sku")) {
            throw new Error("SKU already exists for this product type");
          }
          if (target?.includes("barcode")) {
            throw new Error("Barcode already exists for this product type");
          }
        }
        throw error;
      }

      if (parsedVariantValueIds.length > 0) {
        await tx.productVariantValues.createMany({
          data: parsedVariantValueIds.map((vId) => ({
            productVariantId: variantId,
            variantValueId: vId,
          })),
        });
      }

      if (shouldUpdateStock) {
        const openingUnitCost = await resolveCostPerBaseUnit(
          tx,
          product.id,
          parsedBaseUnitId,
          purchasePrice ?? 0,
          purchasePriceUnitId ?? null
        );

        let finalParsedStocks = parsedStocks;

        if (parsedTrackingType !== "NONE") {
          const cleanedTrackedItems = validateTrackedItems(parsedTrackedItems);

          // edit-safe duplicate checks
          for (const item of cleanedTrackedItems) {
            if (item.serialNumber) {
              const existsSerial = await tx.productAssetItem.findFirst({
                where: {
                  productVariantId: variantId,
                  serialNumber: item.serialNumber,
                  ...(item.id ? { id: { not: item.id } } : {}),
                },
              });

              if (existsSerial) {
                throw new Error(`Serial Number already exists: ${item.serialNumber}`);
              }
            }

            if (item.assetCode) {
              const existsAsset = await tx.productAssetItem.findFirst({
                where: {
                  productVariantId: variantId,
                  assetCode: item.assetCode,
                  ...(item.id ? { id: { not: item.id } } : {}),
                },
              });

              if (existsAsset) {
                throw new Error(`Asset Code already exists: ${item.assetCode}`);
              }
            }

            if (item.macAddress) {
              const existsMac = await tx.productAssetItem.findFirst({
                where: {
                  productVariantId: variantId,
                  macAddress: normalizeMac(item.macAddress),
                  ...(item.id ? { id: { not: item.id } } : {}),
                },
              });

              if (existsMac) {
                throw new Error(`MAC Address already exists: ${item.macAddress}`);
              }
            }
          }

          finalParsedStocks = groupTrackedItemsToStocks(cleanedTrackedItems);

          // load current in-stock tracked rows
          const existingInStockItems = await tx.productAssetItem.findMany({
            where: {
              productVariantId: variantId,
              status: "IN_STOCK",
            },
            select: {
              id: true,
              branchId: true,
              assetCode: true,
              macAddress: true,
              serialNumber: true,
            },
          });

          const submittedIds = new Set(
            cleanedTrackedItems
              .filter((x) => x.id)
              .map((x) => Number(x.id))
          );

          // update existing rows
          for (const item of cleanedTrackedItems.filter((x) => x.id)) {
            await tx.productAssetItem.update({
              where: { id: Number(item.id) },
              data: {
                branchId: item.branchId,
                assetCode: item.assetCode || undefined,
                macAddress: normalizeMac(item.macAddress) || undefined,
                serialNumber: item.serialNumber || undefined,
                updatedAt: currentDate,
                updatedBy: req.user?.id || null,
              },
            });
          }

          // create new rows
          const newRows = cleanedTrackedItems.filter((x) => !x.id);

          if (newRows.length > 0) {
            await tx.productAssetItem.createMany({
              data: newRows.map((item) => ({
                productVariantId: variantId,
                branchId: item.branchId,
                assetCode: item.assetCode || null,
                macAddress: normalizeMac(item.macAddress) || null,
                serialNumber: item.serialNumber as string,
                status: "IN_STOCK",
                sourceType: productId ? "PRODUCT_EDIT" : "OPENING",
                createdBy: req.user?.id || null,
                updatedBy: req.user?.id || null,
                createdAt: currentDate,
                updatedAt: currentDate,
              })),
            });
          }

          // mark removed rows instead of deleting
          const rowsToRemove = existingInStockItems.filter(
            (row) => !submittedIds.has(row.id)
          );

          for (const row of rowsToRemove) {
            await tx.productAssetItem.update({
              where: { id: row.id },
              data: {
                status: "REMOVED",
                updatedAt: currentDate,
                updatedBy: req.user?.id || null,
              },
            });
          }
        }

        for (const stock of finalParsedStocks) {
          if (!stock.branchId) continue;

          const branchIdNum = Number(stock.branchId);
          const newQty = new Decimal(stock.quantity ?? 0);

          const existingStock = await tx.stocks.findUnique({
            where: {
              productVariantId_branchId: {
                productVariantId: variantId,
                branchId: branchIdNum,
              },
            },
          });

          const oldQty = existingStock?.quantity ?? new Decimal(0);
          const diffQty = newQty.minus(oldQty);

          const note = productId
            ? `Product stock adjusted from ${oldQty.toString()} to ${newQty.toString()} from product form: ${name}`
            : `Opening stock from product form: ${name}`;

          if (!existingStock) {
            await tx.stocks.create({
              data: {
                productVariantId: variantId,
                branchId: branchIdNum,
                quantity: newQty,
                createdBy: req.user?.id || null,
                createdAt: currentDate,
                updatedBy: req.user?.id || null,
                updatedAt: currentDate,
              },
            });

            if (newQty.gt(0)) {
              await addPositiveAdjustmentLayer({
                tx,
                productVariantId: variantId,
                branchId: branchIdNum,
                qtyToAdd: newQty,
                unitCost: openingUnitCost,
                userId: req.user?.id || null,
                currentDate,
                note,
              });
            }

            continue;
          }

          if (diffQty.eq(0)) {
            await tx.stocks.update({
              where: { id: existingStock.id },
              data: {
                updatedBy: req.user?.id || null,
                updatedAt: currentDate,
              },
            });
            continue;
          }

          if (diffQty.gt(0)) {
            await tx.stocks.update({
              where: { id: existingStock.id },
              data: {
                quantity: newQty,
                updatedBy: req.user?.id || null,
                updatedAt: currentDate,
              },
            });

            await addPositiveAdjustmentLayer({
              tx,
              productVariantId: variantId,
              branchId: branchIdNum,
              qtyToAdd: diffQty,
              unitCost: openingUnitCost,
              userId: req.user?.id || null,
              currentDate,
              note,
            });
          } else {
            const reduceQty = diffQty.abs();

            if (oldQty.lt(reduceQty)) {
              throw new Error(`Cannot reduce stock below zero for branch ${branchIdNum}`);
            }

            await consumeFifoForNegativeAdjustment({
              tx,
              productVariantId: variantId,
              branchId: branchIdNum,
              qtyToReduce: reduceQty,
              userId: req.user?.id || null,
              currentDate,
              note,
            });

            await tx.stocks.update({
              where: { id: existingStock.id },
              data: {
                quantity: newQty,
                updatedBy: req.user?.id || null,
                updatedAt: currentDate,
              },
            });
          }
        }
      }

      return product;
    });

    res.status(id ? 200 : 201).json(result);
  } catch (error: any) {
    logger.error("Error upserting product:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getProductById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const productId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    try {
        const product = await prisma.products.findUnique({
          where: { id: Number(productId) },
          include: {
            unitConversions: true, // ✅ add this
            productvariants: {
              include: {
                productVariantValues: { 
                  include: { variantValue: true } 
                },
                productAssetItems: {
                  where: {
                    status: "IN_STOCK",
                  },
                  orderBy: [
                    { branchId: "asc" },
                    { assetCode: "asc" },
                    { macAddress: "asc" },
                  ],
                },
                stocks: { include: { branch: true } },
                purchasePriceUnit: true, // optional
                baseUnit: true,  // optional
                units: true      // optional
              }
            }
          }
        });

        if (!product) {
            res.status(404).json({ message: "Product not found!" });
            return;
        }
        res.status(200).json(product);
    } catch (error) {
        logger.error("Error fetching product by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const productId = id ? (Array.isArray(id) ? id[0] : id) : 0;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    try {
        const product = await prisma.products.findUnique({ where: { id: Number(productId) } });
        if (!product) {
            res.status(404).json({ message: "Product not found!" });
            return;
        }
        await prisma.products.update({
            where: { id: Number(productId) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null
            }
        });
        res.status(200).json(product);
    } catch (error) {
        logger.error("Error deleting product:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const statusProduct = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const productId = id ? (Array.isArray(id) ? id[0] : id) : 0;// Parse user ID from request params

    try {
        // Find the user by ID
        const user = await prisma.products.findUnique({
            where: { id: Number(productId) },
        });

        if (!user) {
            res.status(404).json({ message: "Product not found" });
            return;
        }

        // Toggle the user's status
        const updatedProduct = await prisma.products.update({
            where: { id: Number(productId) },
            data: { isActive: user.isActive === 1 ? 0 : 1 },
        });

        res.status(200).json(updatedProduct);
    } catch (error) {
        logger.error("Error toggling product status:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};