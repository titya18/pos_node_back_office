import express from "express";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllSaleReturnsWithPagination,
    createSaleReturn,
    getSaleReturnById,
    getSaleReturnByReturnId,
    getReturnTrackedItems
} from "../controllers/saleReturnController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Sale-Return"]), getAllSaleReturnsWithPagination);
router.route("/tracked-items").get(verifyToken, getReturnTrackedItems);
router.route("/").post(authorize(["Sale-Return"]), createSaleReturn);
router.route("/return/:id").get(getSaleReturnByReturnId);
router.route("/:id").get(authorize(["Sale-Return"]), getSaleReturnById);
export default router;