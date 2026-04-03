import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllStockReturns,
    upsertReturn,
    deleteReturn,
    getStockReturnById
} from "../controllers/stockReturnController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Stock-Return-View"]), getAllStockReturns).post(authorize(["Stock-Return-Create"]), upsertReturn);
router.route("/:id").get(authorize(["Stock-Return-View"]), getStockReturnById).delete(authorize(["Stock-Return-Delete"]), deleteReturn).put(authorize(["Stock-Return-Edit"]), upsertReturn);

export default router;