import { Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import { buildBranchFilter } from "../utils/branchFilter";

const prisma = new PrismaClient();

const SORT_FIELD_MAP: Record<string, string> = {
  productName: 'p.name',
  variantName: 'pv.name',
  sku: 'pv.sku',
  barcode: 'pv.barcode',
  quantity: 'quantity',
  branchName: 'b.name',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

export const stockSummary = async (req: Request, res: Response) => {
    try {
        const pageSize = parseInt(req.query.pageSize as string, 10) || 10;
        const pageNumber = parseInt(req.query.page as string, 10) || 1;
        const searchTerm = (req.query.searchTerm as string || "").trim();
        const sortField = (req.query.sortField as string) || "productName";
        const sortOrder = req.query.sortOrder === "desc" ? "DESC" : "ASC";
        const offset = (pageNumber - 1) * pageSize;
        const likeTerm = `%${searchTerm}%`;

        /** ======================
         * RBAC BRANCH FILTER
         ====================== */
        const branchFilter = buildBranchFilter(req.user, req.query);
        const branchCondition = branchFilter?.branchId
          ? `AND s."branchId" = ${branchFilter.branchId}`
          : "";

        /** ======================
         * SAFE SORT FIELD
         ====================== */
        const sortColumn = SORT_FIELD_MAP[sortField] || 'p.name';

        /** ======================
         * 1️ COUNT TOTAL VARIANTS
         ====================== */
        const totalResult: any[] = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT pv.id, s."branchId"
                FROM "Stocks" s
                JOIN "ProductVariants" pv ON s."productVariantId" = pv.id
                JOIN "Products" p ON pv."productId" = p.id
                WHERE (
                    p.name ILIKE $1
                    OR pv.name ILIKE $1
                    OR pv.sku ILIKE $1
                    OR pv.barcode ILIKE $1
                )
                ${branchCondition}
                GROUP BY pv.id, s."branchId"
            ) t
        `, likeTerm);

        const total = Number(totalResult[0]?.total || 0);

        /** ======================
         * 2️ FETCH STOCK SUMMARY
         ====================== */
        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                p.id AS "productId",
                p.name AS "productName",

                pv.id AS "variantId",
                pv.name AS "variantName",
                pv."productType" AS "productType",
                pv.sku,
                pv.barcode,

                b.id AS "branchId",
                b.name AS "branchName",

                SUM(s.quantity)::FLOAT AS quantity,

                MIN(s."createdAt") AS "createdAt",
                MAX(s."updatedAt") AS "updatedAt",

                cu.id AS "createdById",
                (cu."firstName" || ' ' || cu."lastName") AS "createdByName",

                uu.id AS "updatedById",
                (uu."firstName" || ' ' || uu."lastName") AS "updatedByName"

            FROM "Stocks" s
            JOIN "ProductVariants" pv ON s."productVariantId" = pv.id
            JOIN "Products" p ON pv."productId" = p.id
            JOIN "Branch" b ON s."branchId" = b.id

            LEFT JOIN "User" cu ON cu.id = (
                SELECT s2."createdBy"
                FROM "Stocks" s2
                WHERE s2."productVariantId" = pv.id
                    AND s2."branchId" = b.id
                    AND s2."createdBy" IS NOT NULL
                ORDER BY s2."createdAt" ASC
                LIMIT 1
            )

            LEFT JOIN "User" uu ON uu.id = (
                SELECT s3."updatedBy"
                FROM "Stocks" s3
                WHERE s3."productVariantId" = pv.id
                    AND s3."branchId" = b.id
                    AND s3."updatedBy" IS NOT NULL
                ORDER BY s3."updatedAt" DESC
                LIMIT 1
            )

            WHERE (
                p.name ILIKE $1
                OR pv.name ILIKE $1
                OR pv.sku ILIKE $1
                OR pv.barcode ILIKE $1
            )
            ${branchCondition}

            GROUP BY
                p.id, pv.id, b.id, cu.id, uu.id

            ORDER BY ${sortColumn} ${sortOrder}
            LIMIT $2 OFFSET $3
        `, likeTerm, pageSize, offset);

        /** ======================
         * 3️ FETCH VARIANT ATTRIBUTES
         ====================== */
        const variantIds = rows.map(r => r.variantId);
        let attributeMap: Record<number, any[]> = {};

        if (variantIds.length > 0) {
            const attrs: any[] = await prisma.$queryRawUnsafe(`
                SELECT
                    pvv."productVariantId" AS "variantId",
                    va.name AS "attributeName",
                    vv.value
                FROM "ProductVariantValues" pvv
                JOIN "VariantValue" vv ON pvv."variantValueId" = vv.id
                JOIN "VariantAttribute" va ON vv."variantAttributeId" = va.id
                WHERE pvv."productVariantId" = ANY($1)
            `, variantIds);

            attrs.forEach(a => {
                if (!attributeMap[a.variantId]) attributeMap[a.variantId] = [];
                attributeMap[a.variantId].push({
                    attributeName: a.attributeName,
                    value: a.value,
                });
            });
        }

        /** ======================
         * 4️ FINAL RESPONSE
         ====================== */
        const data = rows.map(r => ({
            productId: r.productId,
            productName: r.productName,

            variantId: r.variantId,
            variantName: r.variantName,
            productType: r.productType,
            sku: r.sku,
            barcode: r.barcode,

            branchId: r.branchId,
            branchName: r.branchName,

            quantity: r.quantity,

            createdAt: r.createdAt,
            updatedAt: r.updatedAt,

            createdBy: r.createdById ? { id: r.createdById, name: r.createdByName } : null,
            updatedBy: r.updatedById ? { id: r.updatedById, name: r.updatedByName } : null,

            attributes: attributeMap[r.variantId] || [],
        }));

        res.json({
            data,
            pagination: {
                total,
                page: pageNumber,
                pageSize,
                totalPages: Math.ceil(total / pageSize),
            },
        });

    } catch (error) {
        console.error("stockSummary error:", error);
        res.status(500).json({ message: "Failed to load stock summary" });
    }
};