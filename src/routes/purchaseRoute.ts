import express from "express";
import { validatePurchaseRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import {
    getAllPurchases,
    getPurchaseById,
    upsertPurchase,
    insertPurchasePayment,
    getPurchasePaymentById,
    deletePurchase
} from "../controllers/purchaseController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(getAllPurchases).post(validatePurchaseRequest, upsertPurchase);
router.route("/payment").post(insertPurchasePayment);
router.route("/payment/:id").get(getPurchasePaymentById);
router.route("/:id").get(getPurchaseById).put(validatePurchaseRequest, upsertPurchase).delete(deletePurchase);

export default router;