import { NextFunction, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import logger from "../utils/logger";
import { Decimal } from "@prisma/client/runtime/library"
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import multer from "multer";
import path from "path";
import fs from "fs"; // Import fs module to delete file

dayjs.extend(utc);
dayjs.extend(timezone);
const tz = "Asia/Phnom_Penh";
const now = dayjs().tz(tz);
const currentDate = new Date(Date.UTC(now.year(), now.month(), now.date(), now.hour(), now.minute(), now.second()));

const prisma = new PrismaClient();

export const getAllPurchases = async (req: Request, res: Response): Promise<void> => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page ? req.query.page.toString() : "1", 10);
        const searchTerm = req.query.searchTerm ? req.query.searchTerm.toString().trim() : "";
        const sortField = req.query.sortField ? req.query.sortField.toString() : "ref";
        const sortOrder = req.query.sortOrder === "asc" ? "desc" : "asc";
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
                 OR su."name" ILIKE $${idx + 2}
                 OR br."name" ILIKE $${idx + 2})
            `)
            .join(" AND ");

        // Build parameters: $1 = likeTerm, $2..$n = searchword, $n+1 = limit, $n+2 = offset
        const params = [likeTerm, ...searchWords.map(w => `%${w}%`), pageSize, offset];

        // Branch restriction
        let branchRestriction = "";
        if (loggedInUser.roleType === "USER" && loggedInUser.branchId) {
            branchRestriction = `
                AND p."branchId" = ${loggedInUser.branchId}
                AND p."createdBy" = ${loggedInUser.id}
            `;
        }

        // ----- 1) COUNT -----
        const totalResult: any = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM "Purchases" p
            LEFT JOIN "Suppliers" su ON p."supplierId" = su.id
            LEFT JOIN "Branch" br ON p."branchId" = br.id
            LEFT JOIN "User" c ON p."createdBy" = c.id
            LEFT JOIN "User" u ON p."updatedBy" = u.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    p."ref" ILIKE $1
                    OR su."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(p."purchaseDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(p."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(p."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(p."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(p."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
        `, ...params.slice(0, params.length - 2));

        const total = parseInt(totalResult[0]?.total ?? 0, 10);

        // ----- 2) DATA FETCH -----
        const purchases: any = await prisma.$queryRawUnsafe(`
            SELECT p.*,
                   json_build_object('id', su.id, 'name', su.name) AS supplier,
                   json_build_object('id', br.id, 'name', br.name) AS branch,
                   json_build_object('id', c.id, 'firstName', c."firstName", 'lastName', c."lastName") AS creator,
                   json_build_object('id', u.id, 'firstName', u."firstName", 'lastName', u."lastName") AS updater
            FROM "Purchases" p
            LEFT JOIN "Suppliers" su ON p."supplierId" = su.id
            LEFT JOIN "Branch" br ON p."branchId" = br.id
            LEFT JOIN "User" c ON p."createdBy" = c.id
            LEFT JOIN "User" u ON p."updatedBy" = u.id
            WHERE 1=1
                ${branchRestriction}
                AND (
                    p."ref" ILIKE $1
                    OR su."name" ILIKE $1
                    OR br."name" ILIKE $1
                    OR TO_CHAR(p."purchaseDate", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(p."createdAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(p."updatedAt", 'YYYY-MM-DD HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(p."createdAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    OR TO_CHAR(p."updatedAt", 'DD / Mon / YYYY HH24:MI:SS') ILIKE $1
                    ${fullNameConditions ? `OR (${fullNameConditions})` : ""}
                )
            ORDER BY p."${sortField}" ${sortOrder}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, ...params);

        res.status(200).json({ data: purchases, total });

    } catch (error) {
        console.error("Error fetching purchases:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const getNextPurchaseRef = async (req: Request, res: Response): Promise<void> => {
    const { branchId } = req.params;

    if (!branchId) {
        res.status(400).json({ message: "Branch ID is required" });
        return;
    }

    const lastPurchase = await prisma.purchases.findFirst({
        where: {
            branchId: parseInt(branchId, 10),
        },
        orderBy: {
            id: "desc",
        },
        select: {
            ref: true,
        },
    });

    let nextRef = "PO-00001";

    if (lastPurchase?.ref) {
        const lastNumber = parseInt(lastPurchase.ref.split("-")[1], 10) || 0;
        nextRef = `PO-${String(lastNumber + 1).padStart(5, "0")}`;
    }

    res.json({ ref: nextRef });
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/images/purchases/");
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

    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.pdf', '.JPG', '.JPEG', '.PNG', '.WEBP', '.GIF', '.SVG', '.PDF'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
        return cb(new Error("Invalid file type. Only JPG, PNG, WEBP, GIF, SVG, and PDF are allowed."));
    }

    // Check for file size here as well (besides multer's built-in fileSize limit)
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_FILE_SIZE) {
        return cb(new multer.MulterError('LIMIT_FILE_SIZE', 'File is too large')); // Explicitly reject file
    }

    const filePath = path.join("public/images/purchases/", file.originalname);

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

export const upsertPurchase = async (req: Request, res: Response): Promise<void> => {
    const loggedInUser = req.user;
    if (!loggedInUser) {
        res.status(401).json({ message: "User is not authenticated." });
        return;
    }

    const { id } = req.params;
    const { ref, branchId, supplierId, taxRate, taxNet, discount, shipping, grandTotal, status, note, purchaseDetails, purchaseDate, imagesToDelete } = req.body;

    // --- Parse purchaseDetails safely ---
    let parsedPurchaseDetails: any[] = [];
    if (purchaseDetails) {
      if (typeof purchaseDetails === "string") {
        try {
          parsedPurchaseDetails = JSON.parse(purchaseDetails);
        } catch {
          throw new Error("purchaseDetails is not valid JSON");
        }
      } else if (Array.isArray(purchaseDetails)) {
        parsedPurchaseDetails = purchaseDetails;
      } else {
        throw new Error("purchaseDetails must be an array or JSON string");
      }
    }

    // --- Parse purchaseDate safely ---
    let finalPurchaseDate: Date;
    if (purchaseDate) {
      const cleanedDate =
        typeof purchaseDate === "string" && purchaseDate.startsWith('"') && purchaseDate.endsWith('"')
          ? purchaseDate.slice(1, -1)
          : purchaseDate;

      finalPurchaseDate = new Date(cleanedDate);
      if (isNaN(finalPurchaseDate.getTime())) {
        throw new Error("Invalid purchaseDate");
      }
    } else {
      finalPurchaseDate = new Date();
    }

    // Validate
    if (isNaN(finalPurchaseDate.getTime())) {
        throw new Error("Invalid purchaseDate");
    }

    const getPurchaseAmountAuthorize = await prisma.purchaseAmountAuthorize.findFirst();
    if (loggedInUser.roleType !== "ADMIN") {
        if (status === "APPROVED" || status === "RECEIVED" || status === "COMPLETED") {
            if (getPurchaseAmountAuthorize) {
                const { amount } = getPurchaseAmountAuthorize;
                if (grandTotal > amount) {
                    res.status(400).json({ message: "Purchase amount exceeds authorized limit." });
                    return;
                }
            }
        }
    }

    const uploadedImages = req.files ? (req.files as Express.Multer.File[]).map(file => file.path.replace(/^public[\\/]/, "")) : [];
    // Temporary trash folder for reversible deletion
    const trashDir = path.join("public", "trash");
    if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });

    // Keep track of moved files for rollback
    const movedToTrash: { original: string; temp: string }[] = [];
    
    try {
        const result = await prisma.$transaction(async (tx) => {
            const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
            // Verify that loggedInUser is defined
            if (!loggedInUser) {
                res.status(401).json({ message: "User is not authenticated." });
                return;
            }

            const purchaseId = id ? parseInt(id, 10) : undefined;
            if (purchaseId) {
                const checkPurchase = await tx.purchases.findUnique({ where: { id: purchaseId } });
                if (!checkPurchase) {
                    res.status(404).json({ message: "Purchase not found!" });
                    return;
                }
            }

            const checkRef = await tx.purchases.findFirst({
                where: {
                    branchId: Number(branchId),
                    ref: ref,
                    ...(purchaseId && {
                        id: { not: purchaseId }
                    }),
                },
            });

            if (checkRef) {
                res.status(400).json({ message: "Purchase # already exists!" });
                return;
            }

            // let ref = "PR-";

            // // Generate a new ref only for creation
            // if (!id) {
            //     // Query for the highest ref in the same branch
            //     const lastPurchase = await prisma.purchases.findFirst({
            //         where: { branchId: parseInt(branchId, 10) },
            //         orderBy: { id: 'desc' }, // Sort by ref in descending order
            //     });

            //     // Extract and increment the numeric part of the ref
            //     if (lastPurchase && lastPurchase.ref) {
            //         const refNumber = parseInt(lastPurchase.ref.split('-')[1], 10) || 0;
            //         ref += String(refNumber + 1).padStart(5, '0'); // Increment and format with leading zeros
            //     } else {
            //         ref += "00001"; // Start from 00001 if no ref exists for the branch
            //     }
            // }

            // Fetch existing variant images
            let existingImages: string[] = [];
            if (id) {
                const existingPurchase = await tx.purchases.findUnique({ where: { id: Number(id) } });
                if (!existingPurchase) throw new Error("Purchase not found!");
                existingImages = existingPurchase.image || [];
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
            const updatedImages = [...existingImages.filter(img => !parsedImagesToDelete.includes(img)), ...uploadedImages];

            const purchase = purchaseId
                ? await tx.purchases.update({
                    where: { id: purchaseId },
                    data: {
                        ref,
                        userId: loggedInUser.id,
                        branchId: parseInt(branchId, 10),
                        supplierId: parseInt(supplierId, 10),
                        purchaseDate: new Date(dayjs(finalPurchaseDate).format("YYYY-MM-DD")),
                        taxRate,
                        taxNet,
                        discount,
                        shipping,
                        grandTotal,
                        status,
                        note,
                        image: updatedImages,
                        updatedAt: currentDate,
                        updatedBy: req.user ? req.user.id : null,
                        receivedAt: status === "RECEIVED" ? currentDate : null,
                        receivedBy: status === "RECEIVED" ? req.user ? req.user.id : null : null,
                        purchaseDetails: {
                            deleteMany: {
                                purchaseId: purchaseId   // MUST include a filter
                            }, // Delete existing purchase details
                            create: parsedPurchaseDetails.map((detail: any) => ({
                                productId: parseInt(detail.productId, 10),
                                productVariantId: parseInt(detail.productVariantId, 10),
                                cost: parseFloat(detail.cost),
                                taxNet: parseFloat(detail.taxNet),
                                taxMethod: detail.taxMethod,
                                discount: detail.discount ? parseFloat(detail.discount) : undefined,
                                discountMethod: detail.discountMethod,
                                total: parseFloat(detail.total),
                                quantity: parseInt(detail.quantity, 10),
                            })),
                        }
                    }
                })
                : await tx.purchases.create({
                    data: {
                        userId: loggedInUser.id,
                        branchId: parseInt(branchId, 10),
                        supplierId: parseInt(supplierId, 10),
                        ref,
                        taxRate,
                        taxNet,
                        discount,
                        shipping,
                        grandTotal,
                        status,
                        note,
                        image: updatedImages,
                        purchaseDate: new Date(dayjs(finalPurchaseDate).format("YYYY-MM-DD")),
                        createdAt: currentDate,
                        updatedAt: currentDate,
                        createdBy: req.user ? req.user.id : null,
                        updatedBy: req.user ? req.user.id : null,
                        receivedAt: status === "RECEIVED" ? currentDate : null,
                        receivedBy: status === "RECEIVED" ? req.user ? req.user.id : null : null,
                        purchaseDetails: {
                            create: parsedPurchaseDetails.map((detail: any) => ({
                                productId: parseInt(detail.productId, 10),
                                productVariantId: parseInt(detail.productVariantId, 10),
                                cost: parseFloat(detail.cost),
                                taxNet: parseFloat(detail.taxNet),
                                taxMethod: detail.taxMethod,
                                discount: detail.discount ? parseFloat(detail.discount) : undefined,
                                discountMethod: detail.discountMethod,
                                total: parseFloat(detail.total),
                                quantity: parseInt(detail.quantity, 10),
                            })),
                        },
                    }
                });
            
            // If status is Received update stock
            if (status === "RECEIVED") {
                for (const detail of parsedPurchaseDetails) {
                    const existingStock = await tx.stocks.findFirst({
                        where: {
                            branchId: parseInt(branchId, 10),
                            productVariantId: parseInt(detail.productVariantId, 10),
                        }
                    });

                    if (existingStock) {
                        // Update the existing stock
                        await tx.stocks.update({
                            where: { id: existingStock.id },
                            data: {
                                quantity: { increment: new Decimal(detail.quantity) },
                                updatedAt: currentDate,
                                updatedBy: req.user ? req.user.id : null
                            }
                        });
                    } else {
                        // Insert new stock
                        await tx.stocks.create({
                            data: {
                                branchId: parseInt(branchId, 10),
                                productVariantId: parseInt(detail.productVariantId, 10),
                                quantity: parseInt(detail.quantity, 10),
                                createdAt: currentDate,
                                createdBy: req.user ? req.user.id : null
                            }
                        });
                    }
                }
            }

            return purchase;
        });
        
        res.status(id ? 200 : 201).json(result);
    } catch (error) {
        logger.error("Error creating/updating purchase:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const insertPurchasePayment = async (req: Request, res: Response): Promise<void> => {
    try {
        const result = await prisma.$transaction(async (prisma) => {
            const loggedInUser = req.user; // Assuming you have a middleware that attaches the logged-in user to the request
            // Verify that loggedInUser is defined
            if (!loggedInUser) {
                res.status(401).json({ message: "User is not authenticated." });
                return;
            }

            const { branchId, purchaseId, paymentMethodId, amount, receive_usd, receive_khr, exchangerate, due_balance } = req.body;

            // Fetch the purchase to get the grandTotal
            const purchase = await prisma.purchases.findUnique({
                where: { id: purchaseId },
                select: { grandTotal: true, paidAmount: true },
            });

            if (!purchase) {
                res.status(404).json({ message: "Purchase not found" });
                return;
            }

            // Handle null for paidAmount by defaulting to 0 if it's null
            const paidAmountNumber = purchase.paidAmount ? purchase.paidAmount.toNumber() : 0;
            const amountNumber = Number(amount); // Convert amount to number if it's not already

            // Calculate the new paidAmount
            const newPaidAmount = purchase.grandTotal.toNumber() <= amountNumber 
                ? purchase.grandTotal.toNumber() 
                : (purchase.grandTotal.toNumber() - paidAmountNumber) <= amountNumber
                ? purchase.grandTotal.toNumber() 
                : (paidAmountNumber + amountNumber); // Now properly add as numbers

            await prisma.purchases.update({
                where: { id: purchaseId },
                data: {
                    paidAmount: newPaidAmount,
                    ...(due_balance <= 0 && {
                        status: "COMPLETED",
                        paymentStatus: "PAID"
                    })
                }
            });

            const amountNum = Number(amount);
            const dueNum = Number(due_balance);
            const finalAmount = dueNum <= 0
                                    ? new Decimal(amountNum).plus(dueNum)
                                    : new Decimal(amountNum);
            const purchasePayment = await prisma.purchaseOnPayments.create({
                data: {
                    branchId: parseInt(branchId, 10),
                    purchaseId: parseInt(purchaseId, 10),
                    paymentMethodId: parseInt(paymentMethodId, 10),
                    userId: loggedInUser.id,
                    amount: finalAmount,
                    receive_usd,
                    receive_khr,
                    exchangerate,
                    createdAt: currentDate,
                    createdBy: req.user ? req.user.id : null,
                    status: "PAID"
                }
            });

            return purchasePayment;
        });
        res.status(201).json(result);
    } catch (error) {
        logger.error("Error inserting purchase payment:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}

export const getPurchaseById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const purchase = await prisma.purchases.findUnique({
            where: { id: parseInt(id, 10) },
            include: { 
                purchaseDetails: {
                    include: {
                        products: true, // Include related products data
                        productvariants: {
                            select: {
                                name: true, // Select the `name` field from `productVariant`
                                barcode: true,
                                sku: true
                            },
                        },
                    },
                },
                suppliers: true, // Include related supplier data
                branch: true, // Include related branch data
                creator: true, // Include related creator data
                updater: true, // Include related updater data
            }, // Include related purchase details
        });

        // Transform data to flatten `name` into `purchaseDetails`
        if (purchase) {
            purchase.purchaseDetails = purchase.purchaseDetails.map((detail: any) => ({
                ...detail,
                name: detail.productvariants.name, // Add `name` directly
            }));
        }

        if (!purchase) {
            res.status(404).json({ message: "Purchase not found!" });
            return;
        }
        res.status(200).json(purchase);
    } catch (error) {
        logger.error("Error fetching purchase by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getPurchasePaymentById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    try {
        const purchasePayment = await prisma.purchaseOnPayments.findMany({ 
            where: { 
                purchaseId: parseInt(id, 10),
                status: 'PAID' 
            },
            orderBy: { id: 'desc' },
            include: {
                paymentMethods: {
                    select: {
                        name: true
                    }
                }
            } 
        });
        res.status(200).json(purchasePayment);
    } catch (error) {
        logger.error("Error fetching purchase payment by ID:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
}

export const deletePayment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { delReason } = req.body;
    try {
        const result = await prisma.$transaction(async (tx) => {
            const payment = await tx.purchaseOnPayments.findUnique({ 
                where: { id: parseInt(id, 10) },
            });
            if (!payment) {
                res.status(404).json({ message: "Payment not found!" });
                return;
            }
            await tx.purchaseOnPayments.update({
                where: { id: parseInt(id, 10) },
                data: {
                    deletedAt: currentDate,
                    deletedBy: req.user ? req.user.id : null,
                    delReason,
                    status: "CANCELLED"
                }
            });

            await tx.purchases.update({
                where: { id: payment.purchaseId },
                data: {
                    paidAmount: {
                        decrement: payment.amount.toNumber()
                    }
                }
            });
            return payment;
        });
        res.status(200).json(result);
    } catch (error) {
        logger.error("Error deleting payment:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const deletePurchase = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { delReason } = req.body;
    try {
        const purchase = await prisma.purchases.findUnique({ 
            where: { id: parseInt(id, 10) },
            include: { purchaseDetails: true } 
        });
        if (!purchase) {
            res.status(404).json({ message: "Purchase not found!" });
            return;
        }
        await prisma.purchases.update({
            where: { id: parseInt(id, 10) },
            data: {
                deletedAt: currentDate,
                deletedBy: req.user ? req.user.id : null,
                delReason,
                status: "CANCELLED"
            }
        });
        res.status(200).json(purchase);
    } catch (error) {
        logger.error("Error deleting purchase:", error);
        const typedError = error as Error;
        res.status(500).json({ message: typedError.message });
    }
};

export const getAmountPurchasings = async (req: Request, res: Response): Promise<void> => {
    try {
        const amountPurchasing = await prisma.purchaseAmountAuthorize.findFirst({
            include: { 
                creator: { select: { id: true, firstName: true, lastName: true } },
                updater: { select: { id: true, firstName: true, lastName: true } }
            }
        });
        res.status(200).json(amountPurchasing);
    } catch (error) {
        logger.error("Error fetching amount purchasing:", error);
        res.status(500).json({ message: (error as Error).message });
    }
};

export const updateAmountPurchasing = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { amount } = req.body;
    try {
        const result = await prisma.purchaseAmountAuthorize.update({
            where: { id: parseInt(id, 10) },
            data: {
                amount: amount,
                updatedAt: currentDate,
                updatedBy: req.user ? req.user.id : null
            }
        });
        res.status(200).json(result);
    } catch (error) {
        logger.error("Error updating amount purchasing:", error);   
        res.status(500).json({ message: (error as Error).message });
    }
};