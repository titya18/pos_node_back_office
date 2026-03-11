import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { buildBranchFilter } from "../utils/branchFilter";
import { getQueryNumber, getQueryString } from "../utils/request";

const prisma = new PrismaClient();

const SORT_FIELD_MAP: Record<string, string> = {
  productName: `p.name`,
  variantName: `pv.name`,
  sku: `pv.sku`,
  barcode: `pv.barcode`,
  quantity: `SUM(s.quantity)`,
  branchName: `b.name`,
  unitName: `u.name`,
  stockAlert: `pv."stockAlert"`,
  stockStatus: `
    CASE
      WHEN SUM(s.quantity) <= 0 THEN 0
      WHEN SUM(s.quantity) <= COALESCE(pv."stockAlert", 0) THEN 1
      ELSE 2
    END
  `,
  createdAt: `MIN(s."createdAt")`,
  updatedAt: `MAX(s."updatedAt")`,
};

export const stockSummary = async (req: Request, res: Response) => {
  try {
    const pageSize = getQueryNumber(req.query.pageSize, 10)!;
    const pageNumber = getQueryNumber(req.query.page, 1)!;
    const searchTerm = getQueryString(req.query.searchTerm, "")!.trim();
    const sortField = getQueryString(req.query.sortField, "productName")!;
    const sortOrder =
      getQueryString(req.query.sortOrder)?.toLowerCase() === "desc"
        ? "desc"
        : "asc";

    const stockStatus = getQueryString(req.query.stockStatus, "")!.trim().toUpperCase();
    const lowStockOnly =
      getQueryString(req.query.lowStockOnly, "false")!.toLowerCase() === "true";

    const offset = (pageNumber - 1) * pageSize;
    const likeTerm = `%${searchTerm}%`;

    const branchFilter = buildBranchFilter(req.user, req.query);
    const branchCondition = branchFilter?.branchId
      ? `AND s."branchId" = ${branchFilter.branchId}`
      : "";

    const sortColumn = SORT_FIELD_MAP[sortField] || `p.name`;

    let havingCondition = "";
    if (lowStockOnly) {
      havingCondition = `HAVING SUM(s.quantity) > 0 AND SUM(s.quantity) <= COALESCE(pv."stockAlert", 0)`;
    } else if (stockStatus === "OUT_OF_STOCK") {
      havingCondition = `HAVING SUM(s.quantity) <= 0`;
    } else if (stockStatus === "LOW_STOCK") {
      havingCondition = `HAVING SUM(s.quantity) > 0 AND SUM(s.quantity) <= COALESCE(pv."stockAlert", 0)`;
    } else if (stockStatus === "IN_STOCK") {
      havingCondition = `HAVING SUM(s.quantity) > COALESCE(pv."stockAlert", 0)`;
    }

    const totalResult: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*) AS total
      FROM (
        SELECT
          pv.id,
          s."branchId"
        FROM "Stocks" s
        JOIN "ProductVariants" pv ON s."productVariantId" = pv.id
        JOIN "Products" p ON pv."productId" = p.id
        WHERE (
          p.name ILIKE $1
          OR pv.name ILIKE $1
          OR pv.sku ILIKE $1
          OR COALESCE(pv.barcode, '') ILIKE $1
        )
        ${branchCondition}
        GROUP BY pv.id, s."branchId", pv."stockAlert"
        ${havingCondition}
      ) t
      `,
      likeTerm
    );

    const total = Number(totalResult[0]?.total || 0);

    const rows: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        p.id AS "productId",
        p.name AS "productName",

        pv.id AS "variantId",
        pv.name AS "variantName",
        pv."productType" AS "productType",
        pv.sku,
        pv.barcode,
        pv."baseUnitId" AS "baseUnitId",
        pv."stockAlert" AS "stockAlert",

        u.id AS "unitId",
        u.name AS "unitName",
        u.type AS "unitType",

        b.id AS "branchId",
        b.name AS "branchName",

        SUM(s.quantity)::FLOAT AS quantity,

        CASE
          WHEN SUM(s.quantity) <= 0 THEN 'OUT_OF_STOCK'
          WHEN SUM(s.quantity) <= COALESCE(pv."stockAlert", 0) THEN 'LOW_STOCK'
          ELSE 'IN_STOCK'
        END AS "stockStatus",

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
      LEFT JOIN "Units" u ON pv."baseUnitId" = u.id

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
        OR COALESCE(pv.barcode, '') ILIKE $1
      )
      ${branchCondition}

      GROUP BY
        p.id,
        p.name,
        pv.id,
        pv.name,
        pv."productType",
        pv.sku,
        pv.barcode,
        pv."baseUnitId",
        pv."stockAlert",
        u.id,
        u.name,
        u.type,
        b.id,
        b.name,
        cu.id,
        cu."firstName",
        cu."lastName",
        uu.id,
        uu."firstName",
        uu."lastName"

      ${havingCondition}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT $2 OFFSET $3
      `,
      likeTerm,
      pageSize,
      offset
    );

    const variantIds = rows.map((r) => r.variantId);
    let attributeMap: Record<number, any[]> = {};

    if (variantIds.length > 0) {
      const attrs: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT
          pvv."productVariantId" AS "variantId",
          va.name AS "attributeName",
          vv.value
        FROM "ProductVariantValues" pvv
        JOIN "VariantValue" vv ON pvv."variantValueId" = vv.id
        JOIN "VariantAttribute" va ON vv."variantAttributeId" = va.id
        WHERE pvv."productVariantId" = ANY($1)
        `,
        variantIds
      );

      attrs.forEach((a) => {
        if (!attributeMap[a.variantId]) attributeMap[a.variantId] = [];
        attributeMap[a.variantId].push({
          attributeName: a.attributeName,
          value: a.value,
        });
      });
    }

    const data = rows.map((r) => ({
      productId: r.productId,
      productName: r.productName,

      variantId: r.variantId,
      variantName: r.variantName,
      productType: r.productType,
      sku: r.sku,
      barcode: r.barcode,

      baseUnitId: r.baseUnitId,
      unitId: r.unitId,
      unitName: r.unitName,
      unitType: r.unitType,

      branchId: r.branchId,
      branchName: r.branchName,

      quantity: Number(r.quantity || 0),
      stockAlert: r.stockAlert != null ? Number(r.stockAlert) : null,
      stockStatus: r.stockStatus,

      createdAt: r.createdAt,
      updatedAt: r.updatedAt,

      createdBy: r.createdById
        ? { id: r.createdById, name: r.createdByName }
        : null,
      updatedBy: r.updatedById
        ? { id: r.updatedById, name: r.updatedByName }
        : null,

      attributes: attributeMap[r.variantId] || [],
    }));

    const summary = data.reduce(
      (acc, item) => {
        acc.totalItems += 1;
        if (item.stockStatus === "IN_STOCK") acc.inStock += 1;
        if (item.stockStatus === "LOW_STOCK") acc.lowStock += 1;
        if (item.stockStatus === "OUT_OF_STOCK") acc.outOfStock += 1;
        return acc;
      },
      {
        totalItems: 0,
        inStock: 0,
        lowStock: 0,
        outOfStock: 0,
      }
    );

    res.json({
      data,
      summary,
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