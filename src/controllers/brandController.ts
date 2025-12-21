import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import multer from "multer";
import logger from "../utils/logger";
import fs from 'fs';  // Import fs module to delete files
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

const prisma = new PrismaClient();

export const getAllBrandsWithPagination = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "name";
        const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
        const offset = (pageNumber - 1) * pageSize;

        // Base LIKE term for simple fields
        const likeTerm = `%${searchTerm}%`;

        // Split search term into words for full name search
        const searchWords = searchTerm.split(/\s+/).filter(Boolean); // ["Lorn", "Titya"]

        // Build full name conditions dynamically
        const fullNameConditions = searchWords
            .map((_, idx) => `
                (c."firstName" ILIKE $${idx + 2} OR c."lastName" ILIKE $${idx + 2}
                 OR u."firstName" ILIKE $${idx + 2} OR u."lastName" ILIKE $${idx + 2})
            `)
            .join(" AND ");

        // Build parameters: $1 = likeTerm, $2..$n = search words, $n+1 = limit, $n+2 = offset
        const params = [likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // 1️ Count total
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Brands" b
            LEFT JOIN "User" c ON b."createdBy" = c.id
            LEFT JOIN "User" u ON b."updatedBy" = u.id
            WHERE
                b."en_name" ILIKE $1
                OR b."description" ILIKE $1
                OR TO_CHAR(b."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // 2️ Fetch paginated data
        const branches: any = await prisma.$queryRawUnsafe(`
            SELECT b.*, 
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "Brands" b
            LEFT JOIN "User" c ON b."createdBy" = c.id
            LEFT JOIN "User" u ON b."updatedBy" = u.id
            WHERE
                b."en_name" ILIKE $1
                OR b."description" ILIKE $1
                OR TO_CHAR(b."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                OR TO_CHAR(b."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
            ORDER BY b."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: branches, total });

    } catch (error) {
        logger.error("Error fetching brands:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getAllBrands = async (req: Request, res: Response): Promise<void> => {
    try {
        const brands = await prisma.brands.findMany(
            {
                where: {
                    deletedAt: null
                }
            }
        );
        res.status(200).json(brands);
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
    const { en_name, kh_name, description } = req.body;
    const utcNow = DateTime.now().setZone("Asia/Phnom_Penh").toUTC();
    const imagePath = req.file ? req.file.path.replace(/^public[\\/]/, '') : undefined; // Use uploaded file path

    try {
        const result = await prisma.$transaction(async (prisma) => {
            const brandId = id ? parseInt(id, 10) : undefined;
            // console.log("Upsert Brand - Received Data:", { id, en_name, kh_name, description, imagePath });

            const checkExisting = await prisma.brands.findFirst({
                where: {
                    en_name,
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
                        en_name,
                        kh_name,
                        description,
                        image: imagePath,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null
                    }
                })
                : await prisma.brands.create({
                    data: {
                        en_name,
                        kh_name,
                        description,
                        image: imagePath,
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null
                    }
                });
                
            return brand;
        });

        res.status(id ? 200 : 201).json(result);
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
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null
            }
        });
        res.status(200).json(brand);
    } catch (error) {
        logger.error("Error deleting brand:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};