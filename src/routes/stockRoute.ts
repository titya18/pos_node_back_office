import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    stockSummary
} from "../controllers/stockController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Check-Stock"]), stockSummary);
export default router;