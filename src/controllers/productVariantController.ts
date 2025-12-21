import { NextFunction, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import multer from "multer";
import path from "path";
import fs from "fs"; // Import fs module to delete file
import logger from "../utils/logger";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

const prisma = new PrismaClient();

export const getAllProductVariant = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
        const offset = (pageNumber - 1) * pageSize;

        const { id } = req.params;
        if (!id) {
            res.status(400).json({ message: "Product ID is required" });
            return;
        }

        const likeTerm = `%${searchTerm}%`;

        // Split searchTerm into words → e.g. "Lorn Titya"
        const searchWords = searchTerm.split(/\s+/).filter(Boolean);

        // creator/updater multi-word name search
        const fullNameConditions = searchWords
            .map((_, idx) => `
                (
                    c."firstName" ILIKE $${idx + 2} OR c."lastName" ILIKE $${idx + 2}
                    OR u2."firstName" ILIKE $${idx + 2} OR u2."lastName" ILIKE $${idx + 2}
                )
            `)
            .join(" OR ");

        // Build params dynamically
        const params = [parseInt(id, 10), likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // 1️ Count total variants matching search
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "ProductVariants" pv
            LEFT JOIN "User" c ON pv."createdBy" = c.id
            LEFT JOIN "User" u2 ON pv."updatedBy" = u2.id
            WHERE pv."productId" = $1
            AND pv."deletedAt" IS NULL
            AND (
                pv."name" ILIKE $2
                OR pv."sku" ILIKE $2
                OR pv."barcode" ILIKE $2
                OR TO_CHAR(pv."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $2
                OR TO_CHAR(pv."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $2
                OR TO_CHAR(pv."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $2
                OR TO_CHAR(pv."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $2
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated variants with product, unit, and user info
        const variants: any = await prisma.$queryRawUnsafe(`
            SELECT 
                pv.*,
                json_build_object('id', p.id, 'name', p.name) AS product,
                json_build_object('id', u.id, 'name', u.name) AS unit,
                json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                json_build_object('id', u2.id, 'firstName', u2."firstName", 'lastName', u2."lastName") AS updater
            FROM "ProductVariants" pv
            LEFT JOIN "Products" p ON pv."productId" = p.id
            LEFT JOIN "Units" u ON pv."unitId" = u.id
            LEFT JOIN "User" c ON pv."createdBy" = c.id
            LEFT JOIN "User" u2 ON pv."updatedBy" = u2.id
            WHERE pv."productId" = $1
            AND pv."deletedAt" IS NULL
            AND (
                pv."name" ILIKE $2
                OR pv."sku" ILIKE $2
                OR pv."barcode" ILIKE $2
                OR TO_CHAR(pv."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $2
                OR TO_CHAR(pv."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $2
                OR TO_CHAR(pv."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $2
                OR TO_CHAR(pv."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $2
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
        )
            ORDER BY p."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        // 3️ Fetch variant values for all variant IDs
        const variantIds = variants.map((v: any) => v.id);
        let variantValuesMap: Record<number, { variantAttributeId: number, variantValueId: number }[]> = {};
        if (variantIds.length > 0) {
            type VariantValueRow = {
                variantId: number;
                variantValueId: number;
                variantAttributeId: number;
            };

            const variantValues = await prisma.$queryRawUnsafe(`
                SELECT pvv."productVariantId" AS "variantId",
                    vv.id AS "variantValueId",
                    va.id AS "variantAttributeId"
                FROM "ProductVariantValues" pvv
                JOIN "VariantValue" vv ON pvv."variantValueId" = vv.id
                JOIN "VariantAttribute" va ON vv."variantAttributeId" = va.id
                WHERE pvv."productVariantId" = ANY($1)
            `, variantIds) as VariantValueRow[];

            variantValues.forEach((vv: VariantValueRow) => {
                if (!variantValuesMap[vv.variantId]) variantValuesMap[vv.variantId] = [];
                variantValuesMap[vv.variantId].push({
                variantAttributeId: vv.variantAttributeId,
                variantValueId: vv.variantValueId
                });
            });
        }

        // 4️ Transform for frontend
        const data = variants.map((variant: any) => {
            const variantAttributeIds = variantValuesMap[variant.id]?.map((v: any) => v.variantAttributeId) || [];
            const variantValueIds = variantValuesMap[variant.id]?.map((v: any) => v.variantValueId) || [];

            return {
                id: variant.id,
                productId: variant.productId,
                unitId: variant.unitId,
                sku: variant.sku,
                barcode: variant.barcode,
                name: variant.name,
                image: variant.image,
                purchasePrice: variant.purchasePrice,
                retailPrice: variant.retailPrice,
                wholeSalePrice: variant.wholeSalePrice,
                isActive: variant.isActive,
                createdAt: variant.createdAt,
                updatedAt: variant.updatedAt,
                products: variant.product,
                units: variant.unit,
                creator: variant.creator,
                updater: variant.updater,
                variantAttributeIds,
                variantValueIds
            };
        });

        res.status(200).json({ data, total });
    } catch (error) {
        logger.error("Error in getAllProductVariant:", error);
        res.status(500).json({ message: (error as Error).message });
    }
};


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/images/productvariants/");
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const fileExtension = path.extname(file.originalname);
        const uniqueName = `${uniqueSuffix}${fileExtension}`;
        cb(null, uniqueName);
    }
});

export const fileFilter = async (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // const variantId = req.params.id ? parseInt(req.params.id, 10) : undefined;

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

    const filePath = path.join("public/images/productvariants/", file.originalname);

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

const moveFile = (src: string, dest: string) => {
    if (fs.existsSync(src)) fs.renameSync(src, dest);
};

export const upsertProductVariant = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { productId, unitId, barcode, sku, name, purchasePrice, variantValueIds, retailPrice, wholeSalePrice, isActive, imagesToDelete } = req.body;

    let parsedVariantValueIds: number[] = [];

    if (typeof variantValueIds === "string") {
        parsedVariantValueIds = JSON.parse(variantValueIds);
    } else if (Array.isArray(variantValueIds)) {
        parsedVariantValueIds = variantValueIds;
    }

    const uploadedImages = req.files ? (req.files as Express.Multer.File[]).map(file => file.path.replace(/^public[\\/]/, "")) : [];
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    const variantId = id ? parseInt(id, 10) : undefined;

    // Temporary trash folder for reversible deletion
    const trashDir = path.join("public", "trash");
    if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });

    // Keep track of moved files for rollback
    const movedToTrash: { original: string; temp: string }[] = [];

    try {
        const variant = await prisma.$transaction(async (tx) => {
            // Check uniqueness
            const existingBarcode = await tx.productVariants.findFirst({
                where: { barcode, id: { not: variantId } },
            });
            if (existingBarcode) throw new Error("Variant's barcode must be unique");

            const existingSKU = await tx.productVariants.findFirst({
                where: { sku, id: { not: variantId } },
            });
            if (existingSKU) throw new Error("Variant's SKU must be unique");

            // Fetch existing variant images
            let existingVariantImages: string[] = [];
            if (variantId) {
                const existingVariant = await tx.productVariants.findUnique({ where: { id: variantId } });
                if (!existingVariant) throw new Error("Variant not found!");
                existingVariantImages = existingVariant.image || [];
            }

            // Parse imagesToDelete and move to trash
            let parsedImagesToDelete: string[] = [];
            if (imagesToDelete) {
                parsedImagesToDelete = typeof imagesToDelete === "string" ? JSON.parse(imagesToDelete) : imagesToDelete;
                if (!Array.isArray(parsedImagesToDelete)) parsedImagesToDelete = [];

                parsedImagesToDelete.forEach(imagePath => {
                    const src = path.join("public", imagePath);
                    const dest = path.join(trashDir, path.basename(imagePath));
                    if (fs.existsSync(src)) {
                        moveFile(src, dest);
                        movedToTrash.push({ original: src, temp: dest });
                    }
                });
            }

            // Combine remaining existing images with newly uploaded ones
            const updatedImages = [...existingVariantImages.filter(img => !parsedImagesToDelete.includes(img)), ...uploadedImages];

            // Upsert variant
            if (variantId) {
                const updatedVariant = await tx.productVariants.update({
                    where: { id: variantId },
                    data: {
                        productId: Number(productId),
                        unitId: unitId ? Number(unitId) : null,
                        barcode,
                        sku,
                        name,
                        purchasePrice: Number(purchasePrice),
                        retailPrice: Number(retailPrice),
                        wholeSalePrice: Number(wholeSalePrice),
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null,
                        image: updatedImages,
                    }
                });

                // DELETE old join rows
                await tx.productVariantValues.deleteMany({
                    where: { productVariantId: variantId }
                });

                // INSERT new join rows
                if (parsedVariantValueIds.length > 0) {
                    await tx.productVariantValues.createMany({
                        data: parsedVariantValueIds.map((vId: any) => ({
                            productVariantId: variantId,
                            variantValueId: Number(vId),
                        })),
                    });
                }

                return updatedVariant;
            } else {
                const newVariant = await tx.productVariants.create({
                    data: {
                        productId: Number(productId),
                        unitId: unitId ? Number(unitId) : null,
                        barcode,
                        sku,
                        name,
                        purchasePrice: Number(purchasePrice),
                        retailPrice: Number(retailPrice),
                        wholeSalePrice: Number(wholeSalePrice),
                        isActive: 1,
                        createdAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null,
                        image: updatedImages
                    }
                });

                // INSERT into join table
                if (parsedVariantValueIds.length > 0) {
                    await tx.productVariantValues.createMany({
                        data: parsedVariantValueIds.map((vId: any) => ({
                            productVariantId: newVariant.id,
                            variantValueId: Number(vId),
                        })),
                    });
                }

                return newVariant;
            }
        });

        // Transaction succeeded → permanently delete files in trash
        movedToTrash.forEach(f => {
            if (fs.existsSync(f.temp)) fs.unlinkSync(f.temp);
        });

        res.status(variantId ? 200 : 201).json(variant);

    } catch (error) {
        // Transaction failed → rollback moved images back to original
        movedToTrash.forEach(f => {
            if (fs.existsSync(f.temp)) moveFile(f.temp, f.original);
        });

        // Delete newly uploaded images
        uploadedImages.forEach(imagePath => {
            const fullPath = path.join("public", imagePath);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        });

        logger.error("Error upserting product variant:", error);
        res.status(500).json({ message: (error as Error).message });
    }
};

// export const upsertProductVariant = async (req: Request, res: Response): Promise<void> => {
//     const { id } = req.params;
//     const { productId, unitId, barcode, sku, name, purchasePrice, variantValueIds, retailPrice, wholeSalePrice, isActive, imagesToDelete } = req.body;
//     const imagePaths = req.files ? (req.files as Express.Multer.File[]).map(file => file.path.replace(/^public[\\/]/, "")) : [];
//     const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();

//     try {
//         const result = await prisma.$transaction(async (tx) => {
//             const variantId = id ? parseInt(id, 10) : undefined;

//             const existingBarcode = await tx.productVariants.findFirst({
//                 where: {
//                     barcode,
//                     id: { not: variantId }
//                 }
//             });
//             if (existingBarcode) {
//                 // If existing code, we need to remove image in folder back
//                 imagePaths.forEach((imagePath: string) => {
//                     const fullPath = `public/${imagePath}`;
//                     if (fs.existsSync(fullPath)) {
//                         fs.unlinkSync(fullPath); // Delete file from filesystem
//                     }
//                 });
//                 res.status(400).json({ message: "Varaint's code must be unique" });
//                 return;
//             }

//             // Check for duplicate SKU
//             const existingSKU = await tx.productVariants.findFirst({
//                 where: {
//                     sku,
//                     id: { not: variantId }
//                 }
//             });

//             if (existingSKU) {
//                 imagePaths.forEach(imagePath => {
//                     const fullPath = `public/${imagePath}`;
//                     if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
//                 });
//                 res.status(400).json({ message: "Variant's SKU must be unique" });
//                 return;
//             }

//             let existingImages: string[] = [];
//             if (variantId) {
//                 const checkVaraint = await tx.productVariants.findUnique({ where: { id: variantId } });
//                 if (!checkVaraint) {
//                     res.status(404).json({ message: "Variant not found!" });
//                     return;
//                 }
//                 existingImages = checkVaraint.image || [];
//             }

//             // Parse and handle imagesToDelete
//             const parsedImagesToDelete = typeof imagesToDelete === "string" ? JSON.parse(imagesToDelete) : imagesToDelete;
//             if (Array.isArray(parsedImagesToDelete)) {
//                 parsedImagesToDelete.forEach((imagePath: string) => {
//                     const fullPath = `public/${imagePath}`;
//                     if (fs.existsSync(fullPath)) {
//                         fs.unlinkSync(fullPath); // Delete file from filesystem
//                     }
//                 });

//                 // Remove deleted images from existingImages
//                 existingImages = existingImages.filter(img => !parsedImagesToDelete.includes(img));
//             } else if (imagesToDelete) {
//                 console.error("imagesToDelete is not a valid array:", imagesToDelete);
//             }

//             // Combine new and existing images
//             const updatedImages = [...existingImages, ...imagePaths];

//             // Create or Update the product's variant
//             const variant = variantId
//                 ? await tx.productVariants.update({
//                     where: { id: variantId },
//                     data: {
//                         productId: parseInt(productId, 10),
//                         unitId: unitId ? parseInt(unitId, 10) : null,
//                         barcode,
//                         name,
//                         purchasePrice,
//                         retailPrice,
//                         wholeSalePrice,
//                         isActive,
//                         updatedAt: utcNow.toJSDate(),
//                         image: updatedImages, // Combine existing and new images
//                         variantValues: {
//                             set: Array.isArray(variantValueIds) ? variantValueIds.map((vId: any) => ({ id: Number(vId) })) : []
//                         }
//                     }
//                 })
//                 : await tx.productVariants.create({
//                     data: {
//                         productId: parseInt(productId, 10),
//                         unitId: parseInt(unitId, 10),
//                         barcode,
//                         sku,
//                         name,
//                         purchasePrice,
//                         retailPrice,
//                         wholeSalePrice,
//                         variantValues: Array.isArray(variantValueIds)
//                             ? { connect: variantValueIds.map((vId: any) => ({ id: Number(vId) })) }
//                             : undefined,
//                         isActive,
//                         createdAt: utcNow.toJSDate(),
//                         updatedAt: utcNow.toJSDate(),
//                         image: updatedImages // Include new images only
//                     }
//                 });
//             return variant;
//         });
//         res.status(id ? 200 : 201).json(result);
//     } catch (error) {
//         logger.error("Error upserting product variant:", error);
//         const typedError = error as Error;
//         res.status(500).json({ message: typedError });
//     }
// };

export const getProductVariantById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const variant = await prisma.productVariants.findUnique({
            where: { id: parseInt(id, 10) }
        });
        if (!variant) {
            res.status(404).json({ message: "Variant not found!" });
            return;
        }
        res.status(200).json(variant);
    } catch (error) {
        logger.error("Error fetching product variant by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteProductVaraint = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    try {
        const variant = await prisma.productVariants.findUnique({ where: { id: parseInt(id, 10) } });
        if (!variant) {
            res.status(404).json({ message: "Variant not found!" });
            return;
        }
        await prisma.productVariants.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null
            }
        });
        res.status(200).json(variant);
    } catch (error) {
        logger.error("Error deleting product variant:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const statusVariant = async (req: Request, res: Response): Promise<void> => {
    const variantId = parseInt(req.params.id, 10); // Parse user ID from request params

    try {
        // Find the user by ID
        const variant = await prisma.productVariants.findUnique({
            where: { id: variantId },
        });

        if (!variant) {
            res.status(404).json({ message: "Variant not found" });
            return;
        }

        // Toggle the user's status
        const updatedVariant = await prisma.productVariants.update({
            where: { id: variantId },
            data: { 
                isActive: variant.isActive === 1 ? 0 : 1,
                updatedAt: currentDate,
                updatedBy: req.user ? req.user.id : null
            },
        });

        res.status(200).json(updatedVariant);
    } catch (error) {
        logger.error("Error toggling user status:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};