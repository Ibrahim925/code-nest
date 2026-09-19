// @ts-check

import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig({
  files: ["**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}"],
  ignores: [
    "**/.code-nest/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/.vitest/**",
  ],
  extends: [
    js.configs.recommended,
    tseslint.configs.recommended,
    tseslint.configs.strict,
  ],
});
