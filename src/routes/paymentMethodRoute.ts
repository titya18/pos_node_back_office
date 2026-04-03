import express from "express";
import { validatePaymentMethodRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllPaymentMethodsWithPagination,
    getAllPaymentMethods,
    getPaymentMethodById,
    upsertPaymentMethod,
    deletePaymentMethod
} from "../controllers/paymentMethodController";

const router = express.Router();

router.use(verifyToken);
router.route("/all").get(authorize(["Payment-Method-View"]), getAllPaymentMethods);
router.route("/").get(getAllPaymentMethodsWithPagination).post(authorize(["Payment-Method-Create"]), validatePaymentMethodRequest, upsertPaymentMethod);
router.route("/:id").get(getPaymentMethodById).put(authorize(["Payment-Method-Edit"]), validatePaymentMethodRequest, upsertPaymentMethod).delete(authorize(["Payment-Method-Delete"]), deletePaymentMethod);

export default router;