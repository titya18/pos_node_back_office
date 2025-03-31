import express from "express";
// import { verifyToken } from "../middlewares/auth";

import {
    getAllPermissions
} from "../controllers/permissionController";

const router = express.Router();

router.get("/", getAllPermissions);

export default router;