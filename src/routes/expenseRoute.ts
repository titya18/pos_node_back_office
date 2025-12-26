import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllExpenseWithPagination,
    getAllExpenses,
    getExpenseById,
    upsertExpense,
    deleteExpense
} from "../controllers/expenseController";

const router = express.Router();

router.use(verifyToken);
router.route("/all").get(authorize(["Expense-View"]), getAllExpenses);
router.route("/").get(authorize(["Expense-View"]), getAllExpenseWithPagination).post(authorize(["Expense-Create"]), upsertExpense);
router.route("/:id").get(authorize(["Expense-View"]), getExpenseById).put(authorize(["Expense-Edit"]), upsertExpense).delete(authorize(["Expense-Delete"]), deleteExpense);

export default router;