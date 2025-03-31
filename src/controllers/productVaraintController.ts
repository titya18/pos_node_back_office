import { NextFunction, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import multer from "multer";
import path from "path";
import fs from "fs"; // Import fs module to delete file
import logger from "../utils/logger";
import { log } from "console";

const prisma = new PrismaClient();

export const getAllProductVariant = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "desc" : "asc";
        const skip = (pageNumber - 1) * pageSize;

        const { id } = req.params;
        // console.log("Request Params:", { id, pageSize, pageNumber, searchTerm, sortField, sortOrder });

        if (!id) {
            res.status(400).json({ message: "Product ID is required" });
            return;
        }

        const whereCondition: any = {
            productId: parseInt(id, 10), // Ensure ID is a number
            deletedAt: null
        }

        if (searchTerm) {
            whereCondition.name = {
                contains: searchTerm,
                mode: "insensitive" // Case-Insensitive search
            }
        }

        const total = await prisma.productVariants.count({
            where: whereCondition
        });

        const productvariants = await prisma.productVariants.findMany({
            where: whereCondition,
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc"
            },
            take: pageSize,
            include: {
                products: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                units: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });
        res.status(200).json({ data: productvariants, total });
    } catch (error) {
        logger.error("Error in getAllProductVariant:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
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

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    if (!allowedTypes.includes(file.mimetype)) {
        return cb(new Error("Invalid file type. Only JPG, PNG, WEBP, and GIF are allowed."));
    }

    // Check for file size here as well (besides multer's built-in fileSize limit)
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_FILE_SIZE) {
        return cb(new multer.MulterError('LIMIT_FILE_SIZE', 'File is too large')); // Explicitly reject file
    }

    // if (variantId) {
    //     const existingProduct = await prisma.productVariants.findUnique({
    //         where: { id: variantId },
    //         select: { image: true },
    //     });

    //     if (existingProduct?.image?.includes(file.originalname)) {
    //         console.log(`File ${file.originalname} already exists in the database. Skipping upload.`);
    //         return cb(null, false); // Reject upload
    //     }
    // }

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

export const upsertProductVariant = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { productId, unitId, code, name, purchasePrice, retailPrice, wholeSalePrice, isActive, imagesToDelete } = req.body;
    const imagePaths = req.files ? (req.files as Express.Multer.File[]).map(file => file.path.replace(/^public[\\/]/, "")) : [];
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();

    try {
        const variantId = id ? parseInt(id, 10) : undefined;

        const checkExisting = await prisma.productVariants.findFirst({
            where: {
                code,
                id: { not: variantId }
            }
        });
        if (checkExisting) {
            // If existing code, we need to remove image in folder back
            imagePaths.forEach((imagePath: string) => {
                const fullPath = `public/${imagePath}`;
                if (fs.existsSync(fullPath)) {
                    fs.unlinkSync(fullPath); // Delete file from filesystem
                }
            });
            res.status(400).json({ message: "Varaint's code must be unique" });
            return;
        }

        let existingImages: string[] = [];
        if (variantId) {
            const checkVaraint = await prisma.productVariants.findUnique({ where: { id: variantId } });
            if (!checkVaraint) {
                res.status(404).json({ message: "Variant not found!" });
                return;
            }
            existingImages = checkVaraint.image || [];
        }

        // Parse and handle imagesToDelete
        const parsedImagesToDelete = typeof imagesToDelete === "string" ? JSON.parse(imagesToDelete) : imagesToDelete;
        if (Array.isArray(parsedImagesToDelete)) {
            parsedImagesToDelete.forEach((imagePath: string) => {
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

        // Create or Update the product's variant
        const variant = variantId
            ? await prisma.productVariants.update({
                where: { id: variantId },
                data: {
                    productId: parseInt(productId, 10),
                    unitId: parseInt(unitId, 10),
                    code,
                    name,
                    purchasePrice,
                    retailPrice,
                    wholeSalePrice,
                    isActive,
                    updatedAt: utcNow.toJSDate(),
                    image: updatedImages // Combine existing and new images
                }
            })
            : await prisma.productVariants.create({
                data: {
                    productId: parseInt(productId, 10),
                    unitId: parseInt(unitId, 10),
                    code,
                    name,
                    purchasePrice,
                    retailPrice,
                    wholeSalePrice,
                    isActive,
                    createdAt: utcNow.toJSDate(),
                    updatedAt: utcNow.toJSDate(),
                    image: updatedImages // Include new images only
                }
            });
        res.status(id ? 200 : 201).json(variant);
    } catch (error) {
        logger.error("Error upserting product variant:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError });
    }
};

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
    console.log("dfdfdfdfd:", id);
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
                deletedAt: utcNow.toJSDate()
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
            data: { isActive: variant.isActive === 1 ? 0 : 1 },
        });

        res.status(200).json(updatedVariant);
    } catch (error) {
        logger.error("Error toggling user status:", error);
        const typedError = error as Error; // Type assertion
        res.status(500).json({ message: typedError.message });
    }
};