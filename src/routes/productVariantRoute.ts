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
} from "../controllers/productVaraintController";

const router = express.Router();

router.use(verifyToken);
router.route("/").post(authorize(['Variant-Create']), validateProductVariantRequest, uploadImage, upsertProductVariant);
router.route("/status/:id").get(statusVariant);
router.route("/:id").get(authorize(['Variant-View']), getAllProductVariant, getProductVariantById).put(authorize(['Variant-Edit']), validateProductVariantRequest, uploadImage, upsertProductVariant).delete(authorize(['Variant-Delete']), deleteProductVaraint);

export default router;