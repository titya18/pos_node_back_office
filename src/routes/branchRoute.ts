import express from "express";
import { validateBranchRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import {
    getAllBranch,
    getBranchById,
    upsertBranch
} from "../controllers/branchController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(getAllBranch).post(validateBranchRequest, upsertBranch);
router.route("/:id").get(getBranchById).put(validateBranchRequest, upsertBranch);

export default router;