import { beforeAll, describe, expect, test } from "@jest/globals";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import app from "../app"; // Import your Express app

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.deleteMany(); // Clear users before test
});

describe("Auth API", () => {
  let token: string;

  test("Sign Up a new user", async () => {
    const res = await request(app).post("/api/auth/signUpUser").send({
      firstName: "John",
      lastName: "Doe",
      phoneNumber: "123456789",
      email: "test@example.com",
      password: "password123",
    });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("test@example.com");

    token = res.body.token;

    // Log token to see if it is set correctly
    console.log("Token:", token);
  });

  test("Sign In with valid credentials", async () => {
    const res = await request(app).post("/api/auth/signIn").send({
      email: "test@example.com",
      password: "password123",
    });

    console.log("Sign In Response Hi:", res.body); // Log the response body

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("test@example.com");
    token = res.body.token;

    console.log("Token:", token); // Ensure token is set correctly
  });

  test("Validate Token", async () => {
    if (!token) {
        throw new Error("Token not set in the Sign In test");
    }

    const res = await request(app)
        .get("/api/auth/validateToken")
        .set("Cookie", `auth_token=${token}`); // Ensure it’s correctly passed

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("test@example.com");
  });

  test("Sign Out", async () => {
    const res = await request(app).post("/api/auth/signOut");
    expect(res.status).toBe(200);
  });

  test("Reject Sign In with wrong password", async () => {
    const res = await request(app).post("/api/auth/signIn").send({
      email: "test@example.com",
      password: "wrongpassword",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid Credentials");
  });
});

// Run the test with the command `npx jest test_automated/authController.test.ts` in the terminal in root backend folder
// If you see all the ✅, then you have successfully tested the Brand API endpoints
// You can also test the other API endpoints in a similar way
// You can also add more tests to cover more scenarios
// For example, you can test for invalid inputs, unauthorized access, etc.
// You can also test the frontend by writing tests for the frontend components
// You can also automate the frontend tests using tools like Cypress
// You can also automate the API tests using tools like Postman


