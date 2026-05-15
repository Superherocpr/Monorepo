/**
 * customer-dashboard.spec.ts — Customer dashboard end-to-end tests.
 * Requires an authenticated customer session (uses tests/.auth/customer.json).
 * Runs under the "customer" project.
 *
 * Tests cover: all dashboard sub-pages load without 500 errors, the settings
 * page renders the profile form, and the certifications page is accessible.
 */

import { test, expect } from "@playwright/test";

test.describe("Customer dashboard", () => {
  test("dashboard home loads", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("my bookings page loads", async ({ page }) => {
    await page.goto("/dashboard/bookings");
    await expect(page).toHaveURL(/\/dashboard\/bookings/);
    // Either a list of bookings or an empty state message
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("my certifications page loads", async ({ page }) => {
    await page.goto("/dashboard/certifications");
    await expect(page).toHaveURL(/\/dashboard\/certifications/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("my orders page loads", async ({ page }) => {
    await page.goto("/dashboard/orders");
    await expect(page).toHaveURL(/\/dashboard\/orders/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("account settings page loads with profile form", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page).toHaveURL(/\/dashboard\/settings/);
    // Settings page has first-name and last-name fields
    await expect(page.getByLabel(/first name/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByLabel(/last name/i)).toBeVisible();
  });

  test("settings page renders change-password section", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(
      page.getByRole("heading", { name: /change password/i })
    ).toBeVisible({ timeout: 8_000 });
    await expect(page.locator("#currentPassword")).toBeVisible();
  });
});
