import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import multer from "multer";
import logger from "../utils/logger";
import path from "path";
import fs from 'fs';  // Import fs module to delete files
import { log } from "console";

const prisma = new PrismaClient();

export const getAllBrands = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "desc" : "asc";
        const skip = (pageNumber - 1) * pageSize;

        const whereCondition: any = {
            deletedAt: null
        }

        if (searchTerm) {
            whereCondition.name = {
                contains: searchTerm,
                mode: "insensitive" // Case-Insensitive search
            }
        }

        const total = await prisma.brands.count({
            where: whereCondition
        });

        const brands = await prisma.brands.findMany({
            where: whereCondition,
            skip: skip,
            orderBy: {
                [sortField]: sortOrder as "asc" | "desc"
            },
            take: pageSize
        });
        res.status(200).json({ data: brands, total });
    } catch (error) {
        logger.error("Error fetching brands:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

// Configure storage for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "public/images/brands/"); // Directory for storing uploaded files
    },
    filename: function (req, file, cb) {
        cb(null, `${Date.now()}-${file.originalname}`); // Unique file name
    }
});

export const uploadImage = multer({ storage }).single("image");

export const upsertBrand = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, description } = req.body;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    const imagePath = req.file ? req.file.path.replace(/^public[\\/]/, '') : undefined; // Use uploaded file path

    try {
        const brandId = id ? parseInt(id, 10) : undefined;

        const checkExisting = await prisma.brands.findFirst({
            where: {
                name,
                id: { not: brandId }
            }
        });
        
        if (checkExisting) {
            // Delete uploaded image if brand name conflict is found
            if (imagePath) {
                const filePath = `public/${imagePath}`;
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath); // Delete the uploaded image
                }
            }

            res.status(400).json({ message: "Brand's name must be unique" });
            return;
        }

        if (brandId) {
            const checkBrand = await prisma.brands.findUnique({ where: { id: brandId } });
            if (!checkBrand) {
                res.status(404).json({ message: "Brand not found!" });
                return;
            }

            // If an image exists for this brand and a new image is provided, delete the old image
            if (checkBrand.image && imagePath && checkBrand.image !== imagePath) {
                const oldImagePath = `public/${checkBrand.image}`;
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath); // Delete the old image file
                }
            }
        }

        const brand = id
            ? await prisma.brands.update({
                where: { id: brandId },
                data: {
                    name,
                    description,
                    image: imagePath,
                    updatedAt: utcNow.toJSDate()
                }
            })
            : await prisma.brands.create({
                data: {
                    name,
                    description,
                    image: imagePath,
                    createdAt: utcNow.toJSDate(),
                    updatedAt: utcNow.toJSDate()
                }
            });
        res.status(id ? 200 : 201).json(brand);
    } catch (error) {
        logger.error("Error upserting brand:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getBrandById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const brand = await prisma.brands.findUnique({
            where: { id: parseInt(id, 10) }
        });
        if (!brand) {
            res.status(404).json({ message: "Brand not found!" });
            return;
        }
        res.status(200).json(brand);
    } catch (error) {
        logger.error("Error fetching brand by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deleteBrand = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const utcNow = DateTime.now().setZone('Asia/Phnom_Penh').toUTC();
    try {
        const brand = await prisma.brands.findUnique({ where: { id: parseInt(id, 10) } });
        if (!brand) {
            res.status(404).json({ message: "Brand not found!" });
            return;
        }
        await prisma.brands.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: utcNow.toJSDate()
            }
        });
        res.status(200).json(brand);
    } catch (error) {
        logger.error("Error deleting brand:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};