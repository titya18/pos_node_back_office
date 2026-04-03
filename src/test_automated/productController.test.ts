import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import app from "../app"; // Ensure this is your Express app instance
import { getAuthToken } from "./testUtils.test"; // Import utility function

const prisma = new PrismaClient();
let authToken: string; // Store token globally

beforeAll(async () => {
    authToken = await getAuthToken(); // Get the token before tests

    // Clear products, categories, and brands before tests
    await prisma.products.deleteMany();
    await prisma.categories.deleteMany();
    await prisma.brands.deleteMany();

    // Create a category and a brand for the tests
    await prisma.categories.create({
        data: {
            id: 1,
            name: "Test Category",
            code: "TEST_CODE",
        },
    });

    await prisma.brands.create({
        data: {
            id: 1,
            en_name: "Test Brand",
            kh_name: "Test Brand",
        },
    });
});

afterAll(async () => {
    await prisma.$disconnect();
});

describe("ProductController API Tests", () => {
    let productId: number;

    test("POST /products should create a new product with images", async () => {
        const response = await request(app)
            .post("/api/product")
            .set("Cookie", `auth_token=${authToken}`)
            .send({
                name: "New Product",
                categoryId: 1,
                brandId: 1,
                images: ["image1.jpg", "image2.jpg"],
            });

        if (response.status !== 201) {
            console.error("Error response:", response.body);
        }

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty("id");
        // expect(response.body.images).toEqual(["image1.jpg", "image2.jpg"]);
        productId = response.body.id; // Store the product ID for later tests

        // Log the created product
        console.log("Created Product:", response.body);
    });

    test("GET /products should return all products", async () => {
        const res = await request(app)
        .get("/api/product")
        .set("Cookie", `auth_token=${authToken}`) // Add the token
  
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);

        // Log the fetched products
        console.log("Fetched Products:", res.body.data);
    });

    test("GET /products/:id should return a single product", async () => {
        const product = await prisma.products.findFirst();
        if (product) {
            const response = await request(app).get(`/api/product/${product.id}`).set("Cookie", `auth_token=${authToken}`).expect(200);
            expect(response.body).toHaveProperty("name", product.name);

            // Log the fetched product by ID
            console.log("Fetched Product by ID:", response.body);
        }
    });

    test("PUT /products/:id should update an existing product with images", async () => {
        const product = await prisma.products.findFirst();
        if (product) {
            const response = await request(app)
                .put(`/api/product/${product.id}`)
                .set("Cookie", `auth_token=${authToken}`)
                .send({
                    name: "Updated Name",
                    categoryId: 1,
                    brandId: 1,
                    images: ["updated_image1.jpg", "updated_image2.jpg"],
                });

            if (response.status !== 200) {
                console.error("Error response:", response.body);
            }

            expect(response.status).toBe(200);
            expect(response.body.name).toBe("Updated Name");
            // expect(response.body.images).toEqual(["updated_image1.jpg", "updated_image2.jpg"]);

            // Log the updated product
            console.log("Updated Product:", response.body);
        }
    });

    test("DELETE /products/:id should soft delete a product", async () => {
        const product = await prisma.products.findFirst();
        if (product) {
            await request(app).delete(`/api/product/${product.id}`).set("Cookie", `auth_token=${authToken}`).expect(200);
            const deletedProduct = await prisma.products.findUnique({
                where: { id: product.id },
            });
            expect(deletedProduct?.deletedAt).not.toBeNull();

            // Log the deleted product
            console.log("Deleted Product:", deletedProduct);
        }
    });
});

// Run the test with the command `npx jest test_automated/productController.test.ts` in the terminal in root backend folder
// If you see all the ✅, then you have successfully tested the Product API endpoints
// You can also test the other API endpoints in a similar way
// You can also add more tests to cover more scenarios
// For example, you can test for invalid inputs, unauthorized access, etc.
// You can also test the frontend by writing tests for the frontend components
// You can also automate the frontend tests using tools like Cypress
// You can also automate the API tests using tools like Postman

