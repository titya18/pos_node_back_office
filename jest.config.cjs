module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    setupFiles: ["dotenv/config"], // Load env before tests
    setupFilesAfterEnv: ["<rootDir>/prisma/test.setup.ts"],
    testMatch: [
        "<rootDir>/src/test_automated/**/*.test.ts",
        // "<rootDir>/src/test_unit/**/*.test.ts"
    ]
};
  