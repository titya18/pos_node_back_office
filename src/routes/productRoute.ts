import express from "express";
import { validateProductRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import {
    getAllProducts,
    getProductById,
    upsertProduct,
    uploadImage,
    deleteProduct,
    statusProduct
} from "../controllers/productController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(getAllProducts).post(validateProductRequest, uploadImage, upsertProduct);
router.route("/status/:id").get(statusProduct);
router.route("/:id").get(getProductById).put(validateProductRequest, uploadImage, upsertProduct).delete(deleteProduct);

export default router;