import express from "express";
import { verifyToken } from "../middlewares/auth";

import {
    searchProducts
} from "../controllers/searchProductController";

const router = express.Router();

router.use(verifyToken);
router.route("/").get(searchProducts);

export default router;