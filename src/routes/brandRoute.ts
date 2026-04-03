import express from "express";
import { validateBrandRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllBrandsWithPagination,
    getAllBrands,
    getBrandById,
    upsertBrand,
    uploadImage,
    deleteBrand
} from "../controllers/brandController";

const router = express.Router();

router.use(verifyToken);
router.route("/all").get(authorize(["Brand-View"]), getAllBrands);
router.route("/").get(getAllBrandsWithPagination).post(authorize(["Brand-Create"]), uploadImage, validateBrandRequest, upsertBrand);
router.route("/:id").get(getBrandById).put(authorize(["Brand-Edit"]), uploadImage, validateBrandRequest, upsertBrand).delete(authorize(["Brand-Delete"]), deleteBrand);

export default router;