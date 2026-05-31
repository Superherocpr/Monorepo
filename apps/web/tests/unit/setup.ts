/**
 * Global test setup for Vitest unit tests.
 * Imported automatically by vitest.config.ts via setupFiles.
 *
 * - Adds @testing-library/jest-dom matchers (toBeInTheDocument, toHaveClass, etc.)
 * - Clears localStorage and sessionStorage before each test to prevent state leak
 */
import "@testing-library/jest-dom";
import { afterEach } from "vitest";

afterEach(() => {
  // Reset browser storage between every test so tests can't affect each other
  localStorage.clear();
  sessionStorage.clear();
});
