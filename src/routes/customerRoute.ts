import express from "express";
import { validateCustomerRequest } from "../middlewares/validation";
import { verifyToken, authorize } from "../middlewares/auth";

import {
    getAllCustomersWithPagination,
    getAllCustomers,
    getCustomerById,
    upsertCustomer
} from "../controllers/customerController";

const router = express.Router();

router.use(verifyToken);
router.route("/all").get(getAllCustomers);
router.route("/").get(authorize(["Customer-View"]), getAllCustomersWithPagination).post(authorize(["Customer-Create"]), validateCustomerRequest, upsertCustomer);
router.route("/:id").get(authorize(["Customer-View"]), getCustomerById).put(authorize(["Customer-Edit"]), validateCustomerRequest, upsertCustomer);

export default router;