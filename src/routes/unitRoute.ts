import express from "express";
import { validateUnitRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllUnitsWithPagination,
    getAllUnits,
    getUnitById,
    upsertUnit,
    deleteUnit
} from "../controllers/unitController";

const router = express.Router();

router.use(verifyToken);
router.route("/all").get(authorize(["Unit-View"]), getAllUnits);
router.route("/").get(getAllUnitsWithPagination).post(authorize(["Unit-Create"]), validateUnitRequest, upsertUnit);
router.route("/:id").get(getUnitById).put(authorize(["Unit-Edit"]), validateUnitRequest, upsertUnit).delete(authorize(["Unit-Delete"]), deleteUnit);

export default router;