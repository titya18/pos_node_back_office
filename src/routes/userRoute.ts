import express from "express";
import { validateUserRequest } from "../middlewares/validation";
import { verifyToken } from "../middlewares/auth";

import { 
    getAllUser,
    getUserById,
    createUser,
    updateUser,
    deleteUser,
    statusUser 
} from "../controllers/userController";

const router = express.Router();

router.get("/", verifyToken, getAllUser);
router.get("/:id", verifyToken, getUserById);
router.get("/status/:id", verifyToken, statusUser);
router.post("/", verifyToken, validateUserRequest, createUser);
router.put("/:id", verifyToken, validateUserRequest, updateUser);
router.delete("/:id", verifyToken, deleteUser);

export default router;