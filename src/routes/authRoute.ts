import express, { Request, Response } from 'express';
import { validateLoginRequest, validateUserRequest, handleValidationErrors } from '../middlewares/validation';
import { verifyToken } from "../middlewares/auth";
import rateLimit from 'express-rate-limit';

import {
    signIn,
    signUpUser,
    validateToken,
    signOut
} from '../controllers/authController';

// Rate limiter configuration
const signInLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: { error: "Too many login attempts from this IP, please try again later" }, // Ensure response is JSON
    statusCode: 429 // Too Many Requests
});


const router = express.Router();

router.post('/signUpUser', validateUserRequest, handleValidationErrors, signUpUser);
router.post('/signIn', validateLoginRequest, handleValidationErrors, signInLimiter, signIn);
router.get("/validateToken", verifyToken, validateToken);
router.post("/signOut", signOut);

router.post("/logout", (req: Request, res: Response) => {
    res.cookie("auth_token", "", {
        expires: new Date(0),
    });
    res.send();
});

export default router;