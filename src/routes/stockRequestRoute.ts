import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllStockRequests,
    upsertRequest,
    deleteRequest,
    getStockRequestById
} from "../controllers/stockRequestController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Stock-Request-View"]), getAllStockRequests).post(authorize(["Stock-Request-Create"]), upsertRequest);
router.route("/:id").get(authorize(["Stock-Request-View"]), getStockRequestById).delete(authorize(["Stock-Request-Delete"]), deleteRequest).put(authorize(["Stock-Request-Edit"]), upsertRequest);

export default router;