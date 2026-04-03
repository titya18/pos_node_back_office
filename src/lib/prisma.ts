import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var __prismaSecondary: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ||
  new PrismaClient();

export const prismaSecondary =
  global.__prismaSecondary ||
  new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL_SECONDARY,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
  global.__prismaSecondary = prismaSecondary;
}