import express from "express";
import { validateInvoiceRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllInvoices,
    getInvoiceById,
    upsertInvoice,
    insertInvoicePayment,
    getInvoicePaymentById,
    deleteInvoice,
    deletePayment,
    approveInvoice,
    getNextInvoiceRef
} from "../controllers/invoiceController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Sale-View"]), getAllInvoices).post(validateInvoiceRequest, upsertInvoice);
router.route("/payment").post(authorize(["Sale-Payment"]), insertInvoicePayment);
router.route("/payment/:id").get(getInvoicePaymentById);
router.route("/next-ref/:branchId").get(getNextInvoiceRef);
router.route("/:id").get(authorize(["Sale-View"]), getInvoiceById).put(authorize(["Sale-Edit"]), validateInvoiceRequest, upsertInvoice).delete(authorize(["Sale-Delete"]), deleteInvoice);
router.route("/approve/:id").get(authorize(["Sale-Approve"]), approveInvoice);
router.route("/delpayment/:id").delete(authorize(["Delete-Payment-Sale"]), deletePayment);

export default router;