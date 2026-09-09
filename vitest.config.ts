import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The ASC 606 engine is pure TypeScript and keeps running in a plain node
// environment. Component tests (*.spec.tsx) additionally need React and jsdom;
// they are matched by their own environment glob so the engine suite is
// completely unaffected.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
    environmentMatchGlobs: [["src/**/*.spec.tsx", "jsdom"]],
    setupFiles: ["./src/test/setup-component-tests.ts"],
  },
});
