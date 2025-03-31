import express from "express";
import { validateBranchRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import {
    getAllBrands,
    getBrandById,
    upsertBrand,
    uploadImage,
    deleteBrand
} from "../controllers/brandController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(getAllBrands).post(validateBranchRequest, uploadImage, upsertBrand);
router.route("/:id").get(getBrandById).put(validateBranchRequest, uploadImage, upsertBrand).delete(deleteBrand);

export default router;