import express from "express";
import { validateBranchRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllRole,
    upsertRole,
    getRoleById,
    deleteRole
} from "../controllers/roleController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Role-View"]), verifyToken, getAllRole).post(authorize(["Role-Create"]), verifyToken, validateBranchRequest, upsertRole);
router.route("/:id").get(authorize(["Role-View"]), verifyToken, getRoleById).put(authorize(["Role-Edit"]), verifyToken, validateBranchRequest, upsertRole).delete(authorize(["Role-Delete"]), verifyToken, deleteRole);

export default router;