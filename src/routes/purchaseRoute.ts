import express from "express";
import { validatePurchaseRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllPurchases,
    getPurchaseById,
    upsertPurchase,
    insertPurchasePayment,
    getPurchasePaymentById,
    deletePurchase,
    deletePayment,
    getNextPurchaseRef,
    uploadImage
} from "../controllers/purchaseController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Purchase-View"]), getAllPurchases).post(validatePurchaseRequest, uploadImage, upsertPurchase);
router.route("/payment").post(authorize(["Purchase-Payment"]), insertPurchasePayment);
router.route("/payment/:id").get(getPurchasePaymentById);
router.route("/next-ref/:branchId").get(getNextPurchaseRef);
router.route("/:id").get(authorize(["Purchase-View"]), getPurchaseById).put(authorize(["Purchase-Edit"]), validatePurchaseRequest, uploadImage, upsertPurchase).delete(authorize(["Purchase-Delete"]), deletePurchase);
router.route("/delpayment/:id").delete(authorize(["Delete-Payment-Purchase"]), deletePayment);

export default router;