import express from "express";
import { validateBranchRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllRoleWithPagination,
    getAllRoles,
    upsertRole,
    getRoleById,
    deleteRole
} from "../controllers/roleController";

const router = express.Router();

router.use(verifyToken);
router.route("/all").get(authorize(["Role-View"]), getAllRoles);
router.route("/").get(authorize(["Role-View"]), verifyToken, getAllRoleWithPagination).post(authorize(["Role-Create"]), verifyToken, validateBranchRequest, upsertRole);
router.route("/:id").get(authorize(["Role-View"]), verifyToken, getRoleById).put(authorize(["Role-Edit"]), verifyToken, validateBranchRequest, upsertRole).delete(authorize(["Role-Delete"]), verifyToken, deleteRole);

export default router;