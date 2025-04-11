import express from "express";
import { validatePaymentMethodRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllPaymentMethods,
    getPaymentMethodById,
    upsertPaymentMethod,
    deletePaymentMethod
} from "../controllers/paymentMethodController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Payment-Method-View"]), getAllPaymentMethods).post(authorize(["Payment-Method-Create"]), validatePaymentMethodRequest, upsertPaymentMethod);
router.route("/:id").get(authorize(["Payment-Method-View"]), getPaymentMethodById).put(authorize(["Payment-Method-Edit"]), validatePaymentMethodRequest, upsertPaymentMethod).delete(authorize(["Payment-Method-Delete"]), deletePaymentMethod);

export default router;