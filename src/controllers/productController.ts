import { NextFunction, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import multer from "multer";
import fs from "fs"; // Import fs module to delete files
import path from "path";
import logger from "../utils/logger";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { getQueryNumber, getQueryString } from "../utils/request";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

const prisma = new PrismaClient();

export const getAllProducts = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = getQueryNumber(req.query.pageSize, 10)!;
        const pageNumber = getQueryNumber(req.query.page, 1)!;
        const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
        const sortField = getQueryString(req.query.sortField, "name")!;
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
        console.log(`File ${file.originalname} already exists in the directory. Skipping upload.`);
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

// export const uploadImage = multer({ storage: storage, fileFilter: fileFilter, limits: { fileSize: 5 * 1024 * 1024 }, }).array('images[]', 10); // Max 5 images

// export const upsertProduct = async (req: Request, res: Response): Promise<void> => {
//     const { id } = req.params;
//     const {
//         productType,
//         categoryId,
//         brandId,
//         name,
//         note,
//         isActive,
//         imagesToDelete,
//         unitId,        // default unit (optional)
//         baseUnitId,    // ✅ base unit for stock
//         unitConversions,   // ✅ UOM unitConversions array
//         barcode,
//         sku,
//         purchasePrice,
//         retailPrice,
//         wholeSalePrice,
//         variantValueIds,
//         stocks
//     } = req.body;

//     const imagePaths = req.files ? (req.files as Express.Multer.File[]).map(file => file.path.replace(/^public[\\/]/, "")) : [];

//     // Parse variantValueIds safely
//     let parsedVariantValueIds: number[] = [];
//     if (typeof variantValueIds === "string") {
//         parsedVariantValueIds = JSON.parse(variantValueIds);
//     } else if (Array.isArray(variantValueIds)) {
//         parsedVariantValueIds = variantValueIds;
//     }

//     try {
//         const result = await prisma.$transaction(async (tx) => {
//             const productId = id ? (Array.isArray(id) ? id[0] : id) : 0;
            
//             /* ---------------- Stocks ---------------- */
//             let parsedStocks: { branchId: number; quantity: number }[] = [];

//             if (typeof stocks === "string") {
//                 parsedStocks = JSON.parse(stocks);
//             } else if (Array.isArray(stocks)) {
//                 parsedStocks = stocks.map((s: any) => ({
//                     branchId: Number(s.branchId),
//                     quantity: Number(s.quantity)
//                 }));
//             }

//             // -------------------- PRODUCT --------------------
//             const existingProduct = await tx.products.findFirst({
//                 where: { name, id: { not: Number(productId) } },
//             });
//             if (existingProduct) throw new Error("Product's name must be unique");

//             let existingImages: string[] = [];
//             if (productId) {
//                 const checkProduct = await tx.products.findUnique({ where: { id: Number(productId) } });
//                 if (!checkProduct) throw new Error("Product not found");
//                 existingImages = checkProduct.image || [];
//             }

//             // Handle imagesToDelete
//             const parsedImagesToDelete = typeof imagesToDelete === "string" ? JSON.parse(imagesToDelete) : imagesToDelete;
//             if (Array.isArray(parsedImagesToDelete)) {
//                 parsedImagesToDelete.forEach((imagePath: string) => {
//                     const fullPath = `public/${imagePath}`;
//                     if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
//                 });
//                 existingImages = existingImages.filter(img => !parsedImagesToDelete.includes(img));
//             }

//             const updatedImages = [...existingImages, ...imagePaths];

//             // Upsert product
//             const productData = {
//                 categoryId: parseInt(categoryId, 10),
//                 brandId: parseInt(brandId, 10),
//                 name,
//                 note,
//                 isActive,
//                 image: updatedImages,
//                 updatedAt: currentDate,
//                 updatedBy: req.user?.id || null,
//             };

//             const product = productId
//                 ? await tx.products.update({ where: { id: Number(productId) }, data: productData })
//                 : await tx.products.create({ data: { ...productData, createdAt: currentDate, createdBy: req.user?.id || null } });

//             // -------------------- VARIANT --------------------
//             const existingVariant = await tx.productVariants.findFirst({ where: { productId: product.id } });

//             // // Pre-check uniqueness for friendly messages
//             // const preExisting = await tx.productVariants.findFirst({
//             //     where: {
//             //         OR: [
//             //             { sku, productType, id: { not: existingVariant?.id } },
//             //             { barcode, productType, id: { not: existingVariant?.id } }
//             //         ]
//             //     }
//             // });
//             // if (preExisting) {
//             //     if (preExisting.sku === sku) throw new Error("SKU already exists for this product type");
//             //     if (preExisting.barcode === barcode) throw new Error("Barcode already exists for this product type");
//             // }

//             const variantData = {
//                 productId: product.id,
//                 unitId: unitId ? Number(unitId) : null,
//                 sku,
//                 barcode,
//                 productType,
//                 name,
//                 purchasePrice: Number(purchasePrice),
//                 retailPrice: Number(retailPrice),
//                 wholeSalePrice: Number(wholeSalePrice),
//                 image: updatedImages,
//                 updatedAt: currentDate,
//                 updatedBy: req.user?.id || null,
//             };

//             let variantId: number;

//             try {
//                 if (existingVariant) {
//                     const updatedVariant = await tx.productVariants.update({
//                         where: { id: existingVariant.id },
//                         data: variantData,
//                     });
//                     variantId = updatedVariant.id;

//                     // Remove old variant values
//                     await tx.productVariantValues.deleteMany({ where: { productVariantId: variantId } });

                    
//                 } else {
//                     const newVariant = await tx.productVariants.create({
//                         data: { ...variantData, isActive: 1, createdAt: currentDate, createdBy: req.user?.id || null },
//                     });
//                     variantId = newVariant.id;
//                 }
//             } catch (error: any) {
//                 // Prisma unique constraint error (race condition)
//                 if (error.code === "P2002") {
//                     const target = error.meta?.target;
//                     if (target.includes("sku")) throw new Error("SKU already exists for this product type");
//                     if (target.includes("barcode")) throw new Error("Barcode already exists for this product type");
//                 }
//                 throw error;
//             }

//             // -------------------- VARIANT VALUES --------------------
//             if (parsedVariantValueIds.length > 0) {
//                 await tx.productVariantValues.createMany({
//                     data: parsedVariantValueIds.map(vId => ({ productVariantId: variantId, variantValueId: vId })),
//                 });
//             }

//             // ==================== STOCK LOGIC ====================
//             if (parsedStocks.length > 0) {

//                 for (const stock of parsedStocks) {

//                     if (!stock.branchId || stock.quantity === 0) continue;

//                     await tx.stocks.upsert({
//                         where: {
//                             productVariantId_branchId: {
//                                 productVariantId: variantId,
//                                 branchId: stock.branchId
//                             }
//                         },
//                         update: {
//                             // quantity: { increment: stock.quantity },
//                             quantity: stock.quantity,
//                             updatedBy: req.user?.id || null
//                         },
//                         create: {
//                             productVariantId: variantId,
//                             branchId: stock.branchId,
//                             quantity: stock.quantity,
//                             createdBy: req.user?.id || null
//                         }
//                     });
//                 }
//             }

//             return product;
//         });

//         res.status(id ? 200 : 201).json(result);
//     } catch (error: any) {
//         logger.error("Error upserting product:", error);
//         res.status(500).json({ message: error.message });
//     }
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

    unitId,        // default unit (optional)
    baseUnitId,    // ✅ base unit for stock
    unitConversions,   // ✅ UOM conversions array

    barcode,
    sku,
    purchasePrice,
    retailPrice,
    wholeSalePrice,
    variantValueIds,
    stocks
  } = req.body;

  const imagePaths = req.files
    ? (req.files as Express.Multer.File[]).map(file => file.path.replace(/^public[\\/]/, ""))
    : [];

  // Parse variantValueIds safely
  let parsedVariantValueIds: number[] = [];
  if (typeof variantValueIds === "string") parsedVariantValueIds = JSON.parse(variantValueIds);
  else if (Array.isArray(variantValueIds)) parsedVariantValueIds = variantValueIds.map(Number);

  // Parse stocks safely
  let parsedStocks: { branchId: number; quantity: number }[] = [];
  if (typeof stocks === "string") parsedStocks = JSON.parse(stocks);
  else if (Array.isArray(stocks)) {
    parsedStocks = stocks.map((s: any) => ({ branchId: Number(s.branchId), quantity: Number(s.quantity) }));
  }

  // Parse conversions safely
  let parsedConversions: { fromUnitId: number; toUnitId: number; multiplier: number }[] = [];
  if (typeof unitConversions === "string") parsedConversions = JSON.parse(unitConversions);
  else if (Array.isArray(unitConversions)) {
    parsedConversions = unitConversions.map((c: any) => ({
      fromUnitId: Number(c.fromUnitId),
      toUnitId: Number(c.toUnitId),
      multiplier: Number(c.multiplier),
    }));
  }

  try {
    // -------------------- VALIDATE BASE UNIT --------------------
    if (!baseUnitId) {
      throw new Error("Base unit is required");
    }

    const parsedBaseUnitId = Number(baseUnitId);
    if (isNaN(parsedBaseUnitId)) {
      throw new Error("Invalid base unit");
    }

    const result = await prisma.$transaction(async (tx) => {
      const productId = id ? Number(Array.isArray(id) ? id[0] : id) : 0;

      // -------------------- PRODUCT UNIQUE NAME --------------------
      const existingProduct = await tx.products.findFirst({
        where: { name, id: { not: productId || 0 } },
      });
      if (existingProduct) throw new Error("Product's name must be unique");

      // -------------------- IMAGE MERGE --------------------
      let existingImages: string[] = [];
      if (productId) {
        const checkProduct = await tx.products.findUnique({ where: { id: productId } });
        if (!checkProduct) throw new Error("Product not found");
        existingImages = checkProduct.image || [];
      }

      const parsedImagesToDelete = typeof imagesToDelete === "string" ? JSON.parse(imagesToDelete) : imagesToDelete;
      if (Array.isArray(parsedImagesToDelete)) {
        parsedImagesToDelete.forEach((imagePath: string) => {
          const fullPath = `public/${imagePath}`;
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        });
        existingImages = existingImages.filter(img => !parsedImagesToDelete.includes(img));
      }

      const updatedImages = [...existingImages, ...imagePaths];

      // -------------------- UPSERT PRODUCT --------------------
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

      // -------------------- UOM CONVERSIONS (ProductUnitConversion) --------------------
      // simplest: delete + recreate
      await tx.productUnitConversion.deleteMany({ where: { productId: product.id } });

      if (parsedConversions.length > 0) {
        // Optional: validate multiplier > 0
        if (parsedConversions.some(c => !c.multiplier || c.multiplier <= 0)) {
          throw new Error("UOM multiplier must be > 0");
        }

        // Optional: validate fromUnitId != toUnitId
        if (parsedConversions.some(c => c.fromUnitId === c.toUnitId)) {
          throw new Error("UOM conversion cannot be same unit");
        }

        await tx.productUnitConversion.createMany({
          data: parsedConversions.map(c => ({
            productId: product.id,
            fromUnitId: c.fromUnitId,
            toUnitId: c.toUnitId,
            multiplier: c.multiplier,
          })),
        });
      }

      // -------------------- VARIANT (single default variant per product) --------------------
      const existingVariant = await tx.productVariants.findFirst({ where: { productId: product.id } });

      const variantData = {
        productId: product.id,
        // unitId: unitId ? Number(unitId) : null,
        unitId: parsedBaseUnitId, // ✅ I have change this to always set base unit as variant's unit for stock consistency
        baseUnitId: parsedBaseUnitId,    // ✅ base unit
        sku,
        barcode,
        productType,
        name,
        purchasePrice: Number(purchasePrice),
        retailPrice: Number(retailPrice),
        wholeSalePrice: Number(wholeSalePrice),
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

          // clear old join values
          await tx.productVariantValues.deleteMany({ where: { productVariantId: variantId } });
        } else {
          const newVariant = await tx.productVariants.create({
            data: { ...variantData, isActive: 1, createdAt: currentDate, createdBy: req.user?.id || null },
          });
          variantId = newVariant.id;
        }
      } catch (error: any) {
        if (error.code === "P2002") {
          const target = error.meta?.target;
          if (target?.includes("sku")) throw new Error("SKU already exists for this product type");
          if (target?.includes("barcode")) throw new Error("Barcode already exists for this product type");
        }
        throw error;
      }

      // -------------------- VARIANT VALUES (join table) --------------------
      if (parsedVariantValueIds.length > 0) {
        await tx.productVariantValues.createMany({
          data: parsedVariantValueIds.map(vId => ({
            productVariantId: variantId,
            variantValueId: vId,
          })),
        });
      }

      // -------------------- STOCK (SET quantity, NOT increment) --------------------
      // stocks.quantity must be stored in baseUnit quantity
      for (const stock of parsedStocks) {
        if (!stock.branchId) continue;

        await tx.stocks.upsert({
          where: {
            productVariantId_branchId: {
              productVariantId: variantId,
              branchId: stock.branchId,
            },
          },
          update: {
            quantity: stock.quantity, // ✅ SET
            updatedBy: req.user?.id || null,
          },
          create: {
            productVariantId: variantId,
            branchId: stock.branchId,
            quantity: stock.quantity,
            createdBy: req.user?.id || null,
          },
        });
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
                productVariantValues: { include: { variantValue: true } },
                stocks: { include: { branch: true } },
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