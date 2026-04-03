import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllExchangesWithPagination,
    getLastExchangeRate,
    upsertExchangeRate,
} from "../controllers/exchangeRateController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(getAllExchangesWithPagination).post(authorize(["Exchange-Rate-Create"]), upsertExchangeRate);
router.route("/lastexchange").get(getLastExchangeRate);
router.route("/:id").put(authorize(["Exchange-Rate-Edit"]), upsertExchangeRate);

export default router;