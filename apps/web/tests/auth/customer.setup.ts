/**
 * Customer auth setup — logs in as a known test customer and saves browser
 * state to tests/.auth/customer.json. All customer-scoped test projects
 * declare this as a dependency so they start already authenticated.
 *
 * Credentials are read from environment variables so they are never
 * hard-coded in CI. Provide TEST_CUSTOMER_EMAIL and TEST_CUSTOMER_PASSWORD
 * in your .env.test or CI secrets. The defaults below are staging-only
 * test accounts with no real personal data.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, "../.auth/customer.json");

const EMAIL =
  process.env.TEST_CUSTOMER_EMAIL ?? "james.smith1@test.superherocpr.local";
const PASSWORD = process.env.TEST_CUSTOMER_PASSWORD ?? "TestPass123!";

setup("authenticate as customer", async ({ page }) => {
  await page.goto("/signin");

  // Fill credentials and submit.
  await page.getByLabel("Email").fill(EMAIL);
  await page.locator("#signin-password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for redirect to the dashboard, confirming authentication succeeded.
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/dashboard/);

  // Persist the authenticated session for reuse across test files.
  await page.context().storageState({ path: AUTH_FILE });
});
