import express from "express";
import { validateSupplierRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import {
    getAllSuppliers,
    getSupplierById,
    upsertSupplier,
    deleteSupplier
} from "../controllers/supplierController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(getAllSuppliers).post(validateSupplierRequest, upsertSupplier);
router.route("/:id").get(getSupplierById).put(validateSupplierRequest, upsertSupplier).delete(deleteSupplier);

export default router;