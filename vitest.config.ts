import { defineConfig } from "vitest/config";

// Standalone config: the ASC 606 engine is pure TypeScript with no React,
// DOM, or Vite plugin dependencies, so tests run in a plain node environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
