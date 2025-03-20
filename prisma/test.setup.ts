import { beforeAll, afterAll } from "@jest/globals";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

// ✅ Ensure `.env.test` is loaded first
dotenv.config({ path: ".env.test" });

// ✅ Force DATABASE_URL to use test database
process.env.DATABASE_URL = "postgresql://postgres:password@localhost:5432/node_react_pos_test?schema=public";

console.log("✅ Correct Test Database URL:", process.env.DATABASE_URL);

const prisma = new PrismaClient();

beforeAll(async () => {
  try {
    console.log("🚀 Creating test database if it doesn't exist...");
    execSync(`psql -U postgres -c "CREATE DATABASE node_react_pos_test;"`, {
      stdio: "inherit",
    });
  } catch (error) {
    console.log("⚠️ Test database might already exist. Skipping creation.");
  }

  // ✅ Apply migrations to test database
  execSync("npx prisma migrate reset --force --skip-seed", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }, // Ensure Prisma uses test DB
  });

  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});
