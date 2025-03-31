import request from "supertest";
import { PrismaClient } from "@prisma/client";
import app from "../app"; // Ensure this is your Express app instance

const prisma = new PrismaClient();
let authToken: string | null = null; // Store token globally

/**
 * Signs up a new user and retrieves an authentication token.
 * This function ensures that the token is generated once and reused in tests.
 */
export const getAuthToken = async (): Promise<string> => {
  if (authToken) return authToken; // Return cached token if already set

  // Sign up a new user
  await request(app).post("/api/auth/signUpUser").send({
    firstName: "John",
    lastName: "Doe",
    phoneNumber: "123456789",
    email: "test@example.com",
    password: "password123",
  });

  // Log in to get a valid token
  const res = await request(app).post("/api/auth/signIn").send({
    email: "test@example.com",
    password: "password123",
  });

  if (res.status !== 200) {
    throw new Error("Sign-in failed, cannot retrieve token");
  }

  authToken = res.body.token as string; // Store token globally
  console.log("Auth Token Set:", authToken);
  
  return authToken;
};
