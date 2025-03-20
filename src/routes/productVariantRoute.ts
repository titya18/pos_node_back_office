import express from "express";
import { validateProductVariantRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

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
router.route("/").post(validateProductVariantRequest, uploadImage, upsertProductVariant);
router.route("/status/:id").get(statusVariant);
router.route("/:id").get(getAllProductVariant, getProductVariantById).put(validateProductVariantRequest, uploadImage, upsertProductVariant).delete(deleteProductVaraint);

export default router;