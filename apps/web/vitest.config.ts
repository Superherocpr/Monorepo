/**
 * Vitest configuration for unit tests.
 * Unit tests live under tests/unit/ and cover lib utilities, API routes, and
 * React components. E2E tests (Playwright) remain under tests/e2e/ and are
 * unaffected by this config.
 *
 * Run with: npm run test:unit
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Use jsdom so browser APIs (localStorage, sessionStorage, DOM) are available
    environment: "jsdom",
    // Import @testing-library/jest-dom matchers and global storage helpers
    setupFiles: ["./tests/unit/setup.ts"],
    // Only run tests in the unit subfolder — keeps Playwright tests separate
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    // Enable describe/test/expect/vi as globals so files don't need explicit imports
    globals: true,
  },
  resolve: {
    // Mirror the @/ alias defined in tsconfig.json so imports resolve correctly
    alias: {
      "@": resolve(__dirname, "./"),
    },
  },
});
