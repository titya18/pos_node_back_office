import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllStockAdjustments,
    upsertAdjustment,
    deleteAdjustment,
    getStockAdjustmentById
} from "../controllers/stockAdjustmentController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Adjust-Stock-View"]), getAllStockAdjustments).post(authorize(["Adjust-Stock-Create"]), upsertAdjustment);
router.route("/:id").get(authorize(["Adjust-Stock-View"]), getStockAdjustmentById).delete(authorize(["Adjust-Stock-Delete"]), deleteAdjustment).put(authorize(["Adjust-Stock-Edit"]), upsertAdjustment);

export default router;