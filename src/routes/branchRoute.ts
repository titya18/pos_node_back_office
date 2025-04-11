import express from "express";
import { validateBranchRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllBranch,
    getBranchById,
    upsertBranch
} from "../controllers/branchController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(authorize(["Branch-View"]), getAllBranch).post(authorize(["Branch-Create"]), validateBranchRequest, upsertBranch);
router.route("/:id").get(authorize(["Branch-View"]), getBranchById).put(authorize(["Branch-Edit"]), validateBranchRequest, upsertBranch);

export default router;