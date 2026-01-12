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
router.route("/").get(authorize(["Invoice-View"]), getAllInvoices).post(validateInvoiceRequest, upsertInvoice);
router.route("/payment").post(authorize(["Invoice-Payment"]), insertInvoicePayment);
router.route("/payment/:id").get(getInvoicePaymentById);
router.route("/next-ref/:branchId").get(getNextInvoiceRef);
router.route("/:id").get(authorize(["Invoice-View"]), getInvoiceById).put(authorize(["Invoice-Edit"]), validateInvoiceRequest, upsertInvoice).delete(authorize(["Invoice-Delete"]), deleteInvoice);
router.route("/approve/:id").get(authorize(["Invoice-Approve"]), approveInvoice);
router.route("/delpayment/:id").delete(authorize(["Delete-Payment-Invoice"]), deletePayment);

export default router;