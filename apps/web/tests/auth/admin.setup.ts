/**
 * Admin auth setup — logs in as a super_admin test account and saves browser
 * state to tests/.auth/admin.json. All admin-scoped test projects declare
 * this as a dependency so they start already authenticated.
 *
 * Credentials are read from environment variables so they are never
 * hard-coded in CI. Provide TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD
 * in your .env.test or CI secrets.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, "../.auth/admin.json");

const EMAIL = process.env.TEST_ADMIN_EMAIL ?? "danny@superherocpr.com";
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "TestPass123!";

setup("authenticate as admin", async ({ page }) => {
  await page.goto("/signin");

  // Fill credentials and submit.
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for redirect to the admin dashboard, confirming super_admin auth.
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/admin/);

  // Persist the authenticated session for reuse across test files.
  await page.context().storageState({ path: AUTH_FILE });
});
