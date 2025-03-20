import express from "express";
import { validatePaymentMethodRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import {
    getAllPaymentMethods,
    getPaymentMethodById,
    upsertPaymentMethod,
    deletePaymentMethod
} from "../controllers/paymentMethodController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(getAllPaymentMethods).post(validatePaymentMethodRequest, upsertPaymentMethod);
router.route("/:id").get(getPaymentMethodById).put(validatePaymentMethodRequest, upsertPaymentMethod).delete(deletePaymentMethod);

export default router;