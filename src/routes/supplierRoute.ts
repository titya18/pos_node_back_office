import express from "express";
import { validateSupplierRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllSuppliersWithPagination,
    getAllSuppliers,
    getSupplierById,
    upsertSupplier,
    deleteSupplier
} from "../controllers/supplierController";

const router = express.Router();

router.use(verifyToken);
router.route("/all").get(getAllSuppliers);
router.route("/").get(authorize(["Supplier-View"]), getAllSuppliersWithPagination).post(authorize(["Supplier-Create"]), validateSupplierRequest, upsertSupplier);
router.route("/:id").get(authorize(["Supplier-View"]), getSupplierById).put(authorize(["Supplier-Edit"]), validateSupplierRequest, upsertSupplier).delete(authorize(["Supplier-Delete"]), deleteSupplier);

export default router;