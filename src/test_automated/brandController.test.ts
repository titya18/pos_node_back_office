import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import app from "../app"; // Ensure this is your Express app instance
import { getAuthToken } from "./testUtils.test"; // Import utility function

const prisma = new PrismaClient();
let authToken: string; // Store token globally

beforeAll(async () => {
    authToken = await getAuthToken(); // Get the token before tests

    await prisma.branch.deleteMany(); // Clear branches before tests
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Brand API Endpoints", () => {
    let brandId: number;

    test("✅ Should create a new brand", async () => {
      const res = await request(app)
        .post("/api/brand")
        .set("Cookie", `auth_token=${authToken}`) // Add the token
        .send({
          name: "Nike",
          description: "Sports brand",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      brandId = res.body.id;

      // Log the created brand
      console.log("Created Brand:", res.body);
    });

    test("✅ Should fetch all brands", async () => {
      const res = await request(app)
        .get("/api/brand")
        .set("Cookie", `auth_token=${authToken}`) // Add the token

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      // Log the fetched brands
      console.log("Fetched Brands:", res.body.data);
    });

    test("✅ Should fetch brand by ID", async () => {
      const res = await request(app)
        .get(`/api/brand/${brandId}`)
        .set("Cookie", `auth_token=${authToken}`) // Add the token

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id", brandId);

      // Log the fetched brand by ID
      console.log("Fetched Brand by ID:", res.body);
    });

    test("✅ Should update a brand", async () => {
      const res = await request(app)
        .put(`/api/brand/${brandId}`)
        .set("Cookie", `auth_token=${authToken}`) // Add the token
        .send({
          name: "Nike Updated",
          description: "Updated description",
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Nike Updated");

      // Log the updated brand
      console.log("Updated Brand:", res.body);
    });

    test("✅ Should delete a brand (soft delete)", async () => {
      const res = await request(app)
        .delete(`/api/brand/${brandId}`)
        .set("Cookie", `auth_token=${authToken}`) // Add the token

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("deletedAt");

      // Log the deleted brand
      console.log("Deleted Brand:", res.body);
    });
});

// Run the test with the command `npx jest test_automated/brandController.test.ts` in the terminal in root backend folder
// If you see all the ✅, then you have successfully tested the Brand API endpoints
// You can also test the other API endpoints in a similar way
// You can also add more tests to cover more scenarios
// For example, you can test for invalid inputs, unauthorized access, etc.
// You can also test the frontend by writing tests for the frontend components
// You can also automate the frontend tests using tools like Cypress
// You can also automate the API tests using tools like Postman
