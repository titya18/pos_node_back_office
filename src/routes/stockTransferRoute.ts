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
router.route("/").get(authorize(["Stock-Transfer-View"]), getAllStockTransfer).post(authorize(["Stock-Transfer-Create"]), upsertTransfer);
router.route("/:id").get(authorize(["Stock-Transfer-View"]), getStockTransferById).delete(authorize(["Stock-Transfer-Delete"]), deleteTransfer).put(authorize(["Stock-Transfer-Edit"]), upsertTransfer);

export default router;