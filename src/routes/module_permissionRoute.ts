import express from "express";
import { validateRoleandPermissionRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import {
    upsertModule,
    getModules,
    getModuleById,
    deleteModule
} from "../controllers/module_permissionController";

const router = express.Router();

router.get("/", verifyToken, getModules);
router.get("/:id", verifyToken, getModuleById);
router.post("/", verifyToken, validateRoleandPermissionRequest, upsertModule);
router.put("/:id", verifyToken, validateRoleandPermissionRequest, upsertModule);
router.delete("/:id", verifyToken, deleteModule);

export default router;