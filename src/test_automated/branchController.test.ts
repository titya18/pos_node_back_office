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

describe("Branch API Endpoints", () => {
    let branchId: number;

    test("Should create a new branch", async () => {
      const res = await request(app)
        .post("/api/branch")
        .set("Cookie", `auth_token=${authToken}`) // Add the token
        .send({
          name: "Test Branch",
          address: "123 Test St",
        })
        .expect(201);

      expect(res.body).toHaveProperty("id");
      expect(res.body.name).toBe("Test Branch");
      branchId = res.body.id;

      // Log the created branch
      console.log("Created Branch:", res.body);
    });

    test("Should fetch all branches", async () => {
      const res = await request(app)
        .get("/api/branch")
        .set("Cookie", `auth_token=${authToken}`) // Add the token
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);

      // Log the fetched branches
      console.log("Fetched Branches:", res.body.data);
    });

    test("Should fetch a branch by ID", async () => {
      const res = await request(app)
        .get(`/api/branch/${branchId}`)
        .set("Cookie", `auth_token=${authToken}`) // Add the token
        .expect(200);

      expect(res.body.name).toBe("Test Branch");

      // Log the fetched branch
      console.log("Fetched Branch by ID:", res.body);
    });

    test("Should update a branch", async () => {
      const res = await request(app)
        .put(`/api/branch/${branchId}`)
        .set("Cookie", `auth_token=${authToken}`) // Add the token
        .send({
          name: "Updated Branch",
          address: "456 Updated St",
        })
        .expect(200);

      expect(res.body.name).toBe("Updated Branch");

      // Log the updated branch
      console.log("Updated Branch:", res.body);
    });

    test("Should return 404 for non-existing branch", async () => {
      await request(app)
        .get("/api/branch/99999")
        .set("Cookie", `auth_token=${authToken}`) // Add the token
        .expect(404);
    });

    test("Should enforce unique branch names", async () => {
      const res = await request(app)
        .post("/api/branch")
        .set("Cookie", `auth_token=${authToken}`) // Add the token
        .send({
          name: "Updated Branch",
          address: "789 Duplicate St",
        })
        .expect(400);

      expect(res.body.message).toBe("Branch name must be unique");

      // Log the response for unique branch name enforcement
      console.log("Unique Branch Name Enforcement Response:", res.body);
    });
});

// Run the test with the command `npx jest test_automated/branchController.test.ts` in the terminal in root backend folder
// If you see all the ✅, then you have successfully tested the Brand API endpoints
// You can also test the other API endpoints in a similar way
// You can also add more tests to cover more scenarios
// For example, you can test for invalid inputs, unauthorized access, etc.
// You can also test the frontend by writing tests for the frontend components
// You can also automate the frontend tests using tools like Cypress
// You can also automate the API tests using tools like Postman  
  
