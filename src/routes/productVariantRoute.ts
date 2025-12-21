import express from "express";
import { validateProductVariantRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllProductVariant,
    getProductVariantById,
    upsertProductVariant,
    uploadImage,
    deleteProductVaraint,
    statusVariant
} from "../controllers/productVariantController";

const router = express.Router();

router.use(verifyToken);
router.route("/").post(authorize(['Product-Variant-Create']), validateProductVariantRequest, uploadImage, upsertProductVariant);
router.route("/status/:id").get(statusVariant);
router.route("/:id").get(authorize(['Product-Variant-View']), getAllProductVariant, getProductVariantById).put(authorize(['Product-Variant-Edit']), validateProductVariantRequest, uploadImage, upsertProductVariant).delete(authorize(['Product-Variant-Delete']), deleteProductVaraint);

export default router;