import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Real Git integration tests share disk with parallel Vitest workers.
    testTimeout: 15_000,
    include: [
      "tests/**/*.test.ts",
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
      "scenarios/**/*.test.ts",
    ],
  },
});
