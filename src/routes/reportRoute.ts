import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllReportInvoices,
    getAllCancelReportInvoices,
    getAllPaymentInvoices,
    getAllReportQuotations,
    getAllReportPurchases,
    getAllPaymentPurchases,
    getAllReportAdjustments,
    getAllReportTransfers,
    getAllReportRequests,
    getAllReportReturns,
    getAllReportExpenses,
    getAllReportIncomes
} from "../controllers/reportController";

const router = express.Router();

router.use(verifyToken);
router.route("/reportInvoices").get(authorize(["Invoice-Report"]), getAllReportInvoices);
router.route("/reportCancelInvoices").get(authorize(["Cancel-Invoice"]), getAllCancelReportInvoices);
router.route("/reportPaymentInvoices").get(authorize(["Payment-Report"]), getAllPaymentInvoices);
router.route("/reportQuotations").get(authorize(["Quotation-Report"]), getAllReportQuotations);
router.route("/reportPurchases").get(authorize(["Purchase-Report"]), getAllReportPurchases);
router.route("/reportPaymentPurchases").get(authorize(["Payment-Purchase-Report"]), getAllPaymentPurchases);
router.route("/reportAdjustments").get(authorize(["Adjustment-Report"]), getAllReportAdjustments);
router.route("/reportTransfers").get(authorize(["Transfer-Report"]), getAllReportTransfers);
router.route("/reportRequests").get(authorize(["Request-Report"]), getAllReportRequests);
router.route("/reportReturns").get(authorize(["Return-Report"]), getAllReportReturns);
router.route("/reportExpenses").get(authorize(["Expense-Report"]), getAllReportExpenses);
router.route("/reportIncomes").get(authorize(["Income-Report"]), getAllReportIncomes);
export default router;