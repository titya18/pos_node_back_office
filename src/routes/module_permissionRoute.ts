import express from "express";
import { validateRoleandPermissionRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    upsertModule,
    getModules,
    getModuleById,
    deleteModule
} from "../controllers/module_permissionController";

const router = express.Router();

router.get("/", verifyToken, authorize(["Permission-View"]), getModules);
router.get("/:id", verifyToken, authorize(["Permission-View"]), getModuleById);
router.post("/", verifyToken, authorize(["Permission-Create"]), validateRoleandPermissionRequest, upsertModule);
router.put("/:id", verifyToken, authorize(["Permission-Edit"]), validateRoleandPermissionRequest, upsertModule);
router.delete("/:id", verifyToken, authorize(["Permission-Delete"]), deleteModule);

export default router;