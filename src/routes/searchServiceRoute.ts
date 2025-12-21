import express from "express";
import { verifyToken } from "../middlewares/auth";

import {
    searchServices
} from "../controllers/searchServiceController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(searchServices);

export default router;