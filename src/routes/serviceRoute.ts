import express from "express";
import { validateBranchRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllServicesWithPagination,
    getAllServices,
    getServiceById,
    upsertService,
    deleteService
} from "../controllers/serviceController";

const router = express.Router();

router.use(verifyToken);
router.route("/all").get(authorize(["Service-View"]), getAllServices);
router.route("/").get(authorize(["Service-View"]), getAllServicesWithPagination).post(authorize(["Service-Create"]), validateBranchRequest, upsertService);
router.route("/:id").get(authorize(["Service-View"]), getServiceById).put(authorize(["Service-Edit"]), validateBranchRequest, upsertService).delete(authorize(["Service-Delete"]), deleteService);

export default router;