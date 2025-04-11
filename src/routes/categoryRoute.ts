import express from "express";
import { validateCategoryRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllCategories,
    getCategoryById,
    upsertCategory,
    deleteCategory
} from "../controllers/categoryController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Category-View"]), getAllCategories).post(authorize(["Category-Create"]), validateCategoryRequest, upsertCategory);
router.route("/:id").get(authorize(["Category-View"]), getCategoryById).put(authorize(["Category-Edit"]), validateCategoryRequest, upsertCategory).delete(authorize(["Category-Delete"]), deleteCategory);

export default router;