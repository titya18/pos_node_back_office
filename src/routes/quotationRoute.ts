import express from "express";
import { validateQuotationRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllQuotations,
    getQuotationById,
    upsertQuotation,
    deleteQuotation,
    convertQuotationToOrder,
    getNextQuotationRef
} from "../controllers/quotationController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Quotation-View"]), getAllQuotations).post(validateQuotationRequest, upsertQuotation);
router.route("/next-ref/:branchId").get(getNextQuotationRef);
router.route("/:id").get(authorize(["Quotation-View"]), getQuotationById).put(authorize(["Quotation-Edit"]), validateQuotationRequest, upsertQuotation).delete(authorize(["Quotation-Delete"]), deleteQuotation);
router.route("/convertQTTtoINV/:id").get(authorize(["Convert-QTT-to-INV"]), convertQuotationToOrder);

export default router;