import express from "express";
import { validateCategoryRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import {
    getAllCategories,
    getCategoryById,
    upsertCategory,
    deleteCategory
} from "../controllers/categoryController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(getAllCategories).post(validateCategoryRequest, upsertCategory);
router.route("/:id").get(getCategoryById).put(validateCategoryRequest, upsertCategory).delete(deleteCategory);

export default router;