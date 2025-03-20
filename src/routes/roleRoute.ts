import express from "express";
import { validateBranchRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import {
    getAllRole,
    upsertRole,
    getRoleById,
    deleteRole
} from "../controllers/roleController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(verifyToken, getAllRole).post(verifyToken, validateBranchRequest, upsertRole);
router.route("/:id").get(verifyToken, getRoleById).put(verifyToken, validateBranchRequest, upsertRole).delete(deleteRole);

export default router;