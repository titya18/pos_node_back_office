import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllIncomeWithPagination,
    getAllIncomes,
    getIncomeById,
    upsertIncome,
    deleteIncome
} from "../controllers/incomeController";

const router = express.Router();

router.use(verifyToken);
router.route("/all").get(authorize(["Income-View"]), getAllIncomes);
router.route("/").get(authorize(["Income-View"]), getAllIncomeWithPagination).post(authorize(["Income-Create"]), upsertIncome);
router.route("/:id").get(authorize(["Income-View"]), getIncomeById).put(authorize(["Income-Edit"]), upsertIncome).delete(authorize(["Income-Delete"]), deleteIncome);

export default router;