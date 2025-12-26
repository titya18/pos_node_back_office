import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllReportInvoices,
    getAllCancelReportInvoices,
    getAllPaymentInvoices,
    getAllReportQuotations,
    getAllReportPurchases
} from "../controllers/reportController";

const router = express.Router();

router.use(verifyToken);
router.route("/reportInvoices").get(authorize(["Invoice-Report"]), getAllReportInvoices);
router.route("/reportCancelInvoices").get(authorize(["Cancel-Invoice"]), getAllCancelReportInvoices);
router.route("/reportPaymentInvoices").get(authorize(["Payment-Report"]), getAllPaymentInvoices);
router.route("/reportQuotations").get(authorize(["Quotation-Report"]), getAllReportQuotations);
router.route("/reportPurchases").get(authorize(["Purchase-Report"]), getAllReportPurchases);
export default router;