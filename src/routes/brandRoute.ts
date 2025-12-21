import express from "express";
import { validateBranchRequest } from "../middlewares/validation";
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
router.route("/").get(authorize(["Brand-View"]), getAllBrandsWithPagination).post(authorize(["Brand-Create"]), validateBranchRequest, uploadImage, upsertBrand);
router.route("/:id").get(authorize(["Brand-View"]), getBrandById).put(authorize(["Brand-Edit"]), validateBranchRequest, uploadImage, upsertBrand).delete(authorize(["Brand-Delete"]), deleteBrand);

export default router;