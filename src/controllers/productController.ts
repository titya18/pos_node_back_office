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

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

const prisma = new PrismaClient();

export const getAllProducts = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
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

export const upsertProduct = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { categoryId, brandId, name, note, isActive, imagesToDelete } = req.body;
    const imagePaths = req.files ? (req.files as Express.Multer.File[]).map(file => file.path.replace(/^public[\\/]/, "")) : [];

    try {
        const result = await prisma.$transaction(async (prisma) => {
            const productId = id ? parseInt(id, 10) : undefined;

            const checkExisting = await prisma.products.findFirst({
                where: {
                    name,
                    id: { not: productId },
                },
            });

            if (checkExisting) {
                res.status(400).json({ message: "Product's name must be unique" });
                return;
            }

            let existingImages: string[] = [];
            if (productId) {
                const checkProduct = await prisma.products.findUnique({ where: { id: productId } });
                if (!checkProduct) {
                    res.status(404).json({ message: "Product not found!" });
                    return;
                }
                existingImages = checkProduct.image || [];
            }

            // Parse and handle imagesToDelete
            const parsedImagesToDelete = typeof imagesToDelete === "string" ? JSON.parse(imagesToDelete) : imagesToDelete;

            if (Array.isArray(parsedImagesToDelete)) {
                parsedImagesToDelete.forEach((imagePath: string) => {
                    // const fullPath = path.join("public/images/products/", imagePath);
                    const fullPath = `public/${imagePath}`;
                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath); // Delete file from filesystem
                    }
                });

                // Remove deleted images from existingImages
                existingImages = existingImages.filter(img => !parsedImagesToDelete.includes(img));
            } else if (imagesToDelete) {
                console.error("imagesToDelete is not a valid array:", imagesToDelete);
            }

            // Combine new and existing images
            const updatedImages = [...existingImages, ...imagePaths];

            // Create or Update the product
            const product = productId
                ? await prisma.products.update({
                    where: { id: productId },
                    data: {
                        categoryId: parseInt(categoryId, 10),
                        brandId: parseInt(brandId, 10),
                        name,
                        note,
                        isActive,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null,
                        image: updatedImages, // Combine existing and new images
                    },
                })
                : await prisma.products.create({
                    data: {
                        categoryId: parseInt(categoryId, 10),
                        brandId: parseInt(brandId, 10),
                        name,
                        note,
                        isActive,
                        createdAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null,
                        image: updatedImages, // Include new images only
                    },
                });
            return product;
        });

        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error upserting product:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

// export const upsertProduct = async (req: Request, res: Response): Promise<void> => {
//     const { id } = req.params;
//     const { categoryId, brandId, name, note, isActive } = req.body;
//     const imagePaths = req.files ? (req.files as Express.Multer.File[]).map(file => file.path.replace(/^public[\\/]/, "")) : []; // Handle multiple images
//     const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();

//     try {
//         const productId = id ? parseInt(id, 10) : undefined;

//         const checkExisting = await prisma.products.findFirst({
//             where: {
//                 name,
//                 id: { not: productId }
//             }
//         });

//         if (checkExisting) {
//             // If the product name exists, delete uploaded images and return an error
//             // if (imagePaths) {
//             //     imagePaths.forEach(imagePath => {
//             //         const filePath = `public/${imagePath}`;
//             //         if (fs.existsSync(filePath)) {
//             //             fs.unlinkSync(filePath); // Delete the uploaded image
//             //         }
//             //     });
//             // }
//             res.status(400).json({ message: "Product's name must be unique" });
//             return;
//         }

//         if (productId) {
//             const checkProduct = await prisma.products.findUnique({ where: { id: productId } });
//             if (!checkProduct) {
//                 res.status(404).json({ message: "Product not found!" });
//                 return;
//             }

//             // Delete old images if the product already has them and new ones are uploaded
//             // if (checkProduct.image && imagePaths.length > 0) {
//             //     checkProduct.image.forEach(oldImage => {
//             //         const oldImagePath = `public/${oldImage}`;
//             //         if (fs.existsSync(oldImagePath)) {
//             //             fs.unlinkSync(oldImagePath); // Delete old image file
//             //         }
//             //     });
//             // }
//         }

//         // Create or Update the product
//         console.log("backend:", imagePaths);
//         const product = productId
//             ? await prisma.products.update({
//                 where: { id: productId },
//                 data: {
//                     categoryId: parseInt(categoryId, 10),
//                     brandId: parseInt(brandId, 10),
//                     name,
//                     note,
//                     isActive,
//                     updatedAt: utcNow.toJSDate(),
//                     image: imagePaths.length > 0 ? imagePaths : undefined // Only set image if imagePaths is not empty
//                 }
//             })
//             : await prisma.products.create({
//                 data: {
//                     categoryId: parseInt(categoryId, 10),
//                     brandId: parseInt(brandId, 10),
//                     name,
//                     note,
//                     isActive,
//                     createdAt: utcNow.toJSDate(),
//                     updatedAt: utcNow.toJSDate(),
//                     image: imagePaths.length > 0 ? imagePaths : undefined // Only set image if imagePaths is not empty
//                 }
//             });
//         res.status(id ? 200 : 201).json(product);
//     } catch (error) {
//         const typedError = error as Error;
//         res.status(500).json({ messsage: typedError.message });
//     }
// };

export const getProductById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const product = await prisma.products.findUnique({
            where: { id: parseInt(id, 10) }
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
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    try {
        const product = await prisma.products.findUnique({ where: { id: parseInt(id, 10) } });
        if (!product) {
            res.status(404).json({ message: "Product not found!" });
            return;
        }
        await prisma.products.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: currentDate,
                updatedBy: req.user ? req.user.id : null
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
    const prdouctId = parseInt(req.params.id, 10); // Parse user ID from request params

    try {
        // Find the user by ID
        const user = await prisma.products.findUnique({
            where: { id: prdouctId },
        });

        if (!user) {
            res.status(404).json({ message: "Product not found" });
            return;
        }

        // Toggle the user's status
        const updatedProduct = await prisma.products.update({
            where: { id: prdouctId },
            data: { isActive: user.isActive === 1 ? 0 : 1 },
        });

        res.status(200).json(updatedProduct);
    } catch (error) {
        logger.error("Error toggling user status:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};