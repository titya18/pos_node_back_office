import express from "express";
import { validateUnitRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import {
    getAllUnits,
    getUnitById,
    upsertUnit,
    deleteUnit
} from "../controllers/unitController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(getAllUnits).post(validateUnitRequest, upsertUnit);
router.route("/:id").get(getUnitById).put(validateUnitRequest, upsertUnit).delete(deleteUnit);

export default router;