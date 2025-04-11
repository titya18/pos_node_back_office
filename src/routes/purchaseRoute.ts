import express from "express";
import { validatePurchaseRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

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
router.route("/").get(authorize(["Purchase-View"]), getAllPurchases).post(validatePurchaseRequest, upsertPurchase);
router.route("/payment").post(authorize(["Purchase-Payment"]), insertPurchasePayment);
router.route("/payment/:id").get(getPurchasePaymentById);
router.route("/:id").get(authorize(["Purchase-View"]), getPurchaseById).put(authorize(["Purchase-Edit"]), validatePurchaseRequest, upsertPurchase).delete(authorize(["Purchase-Delete"]), deletePurchase);

export default router;