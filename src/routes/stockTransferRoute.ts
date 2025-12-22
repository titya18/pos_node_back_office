import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllStockTransfer,
    upsertTransfer,
    getStockTransferById,
    deleteTransfer
} from "../controllers/stockTransferController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Stock-Movement-View"]), getAllStockTransfer).post(authorize(["Adjust-Stock-Create"]), upsertTransfer);
router.route("/:id").get(authorize(["Stock-Movement-View"]), getStockTransferById).delete(authorize(["Stock-Movement-Delete"]), deleteTransfer).put(authorize(["Stock-Movement-Edit"]), upsertTransfer);

export default router;