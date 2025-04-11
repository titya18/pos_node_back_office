import express from "express";
import { validateUserRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import { 
    getAllUser,
    getUserById,
    createUser,
    updateUser,
    deleteUser,
    statusUser 
} from "../controllers/userController";

const router = express.Router();

router.get("/", verifyToken, authorize(["User-View"]), getAllUser);
router.get("/:id", verifyToken, authorize(["User-View"]), getUserById);
router.get("/status/:id", verifyToken, statusUser);
router.post("/", verifyToken, authorize(["User-Create"]), validateUserRequest, createUser);
router.put("/:id", verifyToken, authorize(["User-Edit"]), validateUserRequest, updateUser);
router.delete("/:id", verifyToken, authorize(["User-Delete"]), deleteUser);

export default router;