import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Real Git and Docker integration tests share host disk and engine capacity.
    fileParallelism: false,
    testTimeout: 15_000,
    include: [
      "tests/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
      "scenarios/**/*.test.ts",
    ],
  },
});
