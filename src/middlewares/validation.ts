import { body, validationResult } from "express-validator";
import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const handleValidationErrors = async (
    req: Request, res: Response, next: NextFunction
) => {
    const errors = validationResult(req);
    if (!errors.isEmpty) {
        res.status(400).json({ errors: errors.array() });
        return
    }
    next();
};

export const validateLoginRequest = [
    body("email").isEmail().notEmpty().withMessage("Email must be required"),
    body("password").isLength({ min: 6 }).withMessage("Password with 6 or more characters required"),
    // handleValidationErrors,
];

export const validateUserRequest = [
    body("email").isEmail().notEmpty().withMessage("Email must be required").custom(async (email) => {
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });
        if (existingUser) {
            throw new Error("Email is already in use.");
        }
    }),
    body("phoneNumber").notEmpty().withMessage("Phone number must be required"),
    body("firstName").notEmpty().withMessage("First name must be required"),
    body("lastName").notEmpty().withMessage("Last name must be required"),
    body("role").notEmpty().withMessage("Role must be required"),
    body("password").isLength({ min: 6 }).withMessage("Password with 6 or more characters required"),
    
    // Conditional validation for branchId based on roleType
    body("branchId")
        .if((value, { req }) => req.body.roleType === "USER") // Only required if roleType is USER
        .notEmpty()
        .withMessage("Branch ID is required for users with the 'USER' role type"),
    // handleValidationErrors,
];

export const validateRoleandPermissionRequest = [
    body("module").notEmpty().withMessage("Module must be required"),
    handleValidationErrors
];

export const validateBranchRequest = [
    body("name").notEmpty().withMessage("Name must be required"),
    handleValidationErrors
];

export const validatePaymentMethodRequest = [
    body("name").notEmpty().withMessage("Name must be required"),
    handleValidationErrors
];

export const validateCategoryRequest = [
    body("name").notEmpty().withMessage("Category's name must be required"),
    body("code").notEmpty().withMessage("Code must be required").custom(async (code) => {
        const existingCode = await prisma.categories.findUnique({
            where: { code },
        });
        if (existingCode) {
            throw new Error("Code is already in used.");
        }
    }),
    handleValidationErrors
];

export const validateUnitRequest = [
    body("name").notEmpty().withMessage("Unit's name must be required"),
    body("type").notEmpty().withMessage("Unit's type must be required"),
    handleValidationErrors
];

export const validateServiceRequest = [
    body("serviceCode").notEmpty().withMessage("Service code must be required").custom(async (serviceCode) => {
        const existingCode = await prisma.services.findFirst({
            where: {
                serviceCode: serviceCode
            }
        });
        if (existingCode) {
            throw new Error("Service code is already in use.");
        }
    }),
    body("name").notEmpty().withMessage("Name must be required"),
    body("price").notEmpty().withMessage("Price must be required"),
    handleValidationErrors
];

export const validateBrandRequest = [
    body("name").notEmpty().withMessage("Name must be required"),
    handleValidationErrors
];

export const validateProductRequest = [
    body("categoryId").notEmpty().withMessage("Category must be required"),
    body("brandId").notEmpty().withMessage("Brand must be required"),
    body("name").notEmpty().withMessage("Name must be required").custom(async (name) => {
        const existingName = await prisma.products.findUnique({
            where: { name },
        });
        if (existingName) {
            throw new Error("Name is already in used.");
        }
    }),
    handleValidationErrors
];

export const validateProductVariantRequest = [
    body("productId").notEmpty().withMessage("Product must be required"),
    body("unitId").notEmpty().withMessage("Unit must be required"),
    body("barcode").notEmpty().withMessage("Barcode must be required").custom(async (barcode) => {
        const existingCode = await prisma.productVariants.findUnique({
            where: { barcode: barcode }
        });
        if (existingCode) {
            throw new Error("Barcode is already in use.");
        }
    }),
    body("name").notEmpty().withMessage("Name must be required"),
    body("retailPrice").notEmpty().withMessage("Retail price must be required"),
    body("wholeSalePrice").notEmpty().withMessage("Whole sale price must be required"),
    handleValidationErrors
];

export const validateSupplierRequest = [
    body("name").notEmpty().withMessage("Supplier's name must be required"),
    body("phone").notEmpty().withMessage("Phone number must be required").custom(async (phone) => {
        const existingPhone = await prisma.suppliers.findUnique({
            where: { phone }
        });
        if (existingPhone) {
            throw new Error("Phone number is already in used.");
        }
    }),
    body("email").notEmpty().withMessage("Supplier's email must be required"),
    handleValidationErrors
];

export const validatePurchaseRequest = [
    body("supplierId").notEmpty().withMessage("Supplier must be required"),
    body("date").notEmpty().withMessage("Date must be required"),
    // Conditional validation for branchId based on roleType
    body("branchId")
        .if((value, { req }) => req.body.roleType === "USER") // Only required if roleType is USER
        .notEmpty()
        .withMessage("Branch is required"),
    handleValidationErrors
]

export const validateQuotationRequest = [
    body("customerId").notEmpty().withMessage("Customer must be required"),
    body("quotationDate").notEmpty().withMessage("Quotation date must be required"),
    // Conditional validation for branchId based on roleType
    body("branchId")
        .if((value, { req }) => req.body.roleType === "USER") // Only required if roleType is USER
        .notEmpty()
        .withMessage("Branch is required"),
    handleValidationErrors
]

export const validateInvoiceRequest = [
    body("customerId").notEmpty().withMessage("Customer must be required"),
    body("orderDate").notEmpty().withMessage("Quotation date must be required"),
    // Conditional validation for branchId based on roleType
    body("branchId")
        .if((value, { req }) => req.body.roleType === "USER") // Only required if roleType is USER
        .notEmpty()
        .withMessage("Branch is required"),
    handleValidationErrors
]

export const validateVariantAttributeRequest = [
    body("name").notEmpty().withMessage("Variant attribute's name must be required"),
    body("values").isArray().isLength({ min: 1 }).withMessage("Variant attribute's values must have at least one value"),
    handleValidationErrors
];