import express from "express";
import { validateProductRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

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
router.route("/").get(authorize(["Product-View"]), getAllProducts).post(authorize(["Product-Create"]), validateProductRequest, uploadImage, upsertProduct);
router.route("/status/:id").get(statusProduct);
router.route("/:id").get(authorize(["Product-View"]), getProductById).put(authorize(["Product-Edit"]), validateProductRequest, uploadImage, upsertProduct).delete(authorize(["Product-Delete"]), deleteProduct);

export default router;