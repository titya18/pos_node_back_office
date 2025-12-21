import express from "express";
import { validateBranchRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllBranchesWithPagination,
    getAllBranches,
    getBranchById,
    upsertBranch
} from "../controllers/branchController";

const router = express.Router();

router.use(verifyToken);
router.route("/all").get(authorize(["Branch-View"]), getAllBranches);
router.route("/").get(authorize(["Branch-View"]), getAllBranchesWithPagination).post(authorize(["Branch-Create"]), validateBranchRequest, upsertBranch);
router.route("/:id").get(authorize(["Branch-View"]), getBranchById).put(authorize(["Branch-Edit"]), validateBranchRequest, upsertBranch);

export default router;