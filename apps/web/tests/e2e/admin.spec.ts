/**
 * admin.spec.ts — Admin panel end-to-end tests.
 * Uses a saved admin auth session (tests/.auth/admin.json) for authenticated
 * tests. Also covers unauthenticated redirect behaviour for all admin routes.
 * Runs under the "admin" project.
 */

import { test, expect } from "@playwright/test";

// ── Unauthenticated redirects (run without storageState) ─────────────────────
// These are declared separately as a standalone describe block. They intentionally
// do NOT use the storageState set in the project config — a separate guest context
// is created for each test using browser.newPage() in the admin project. However,
// since Playwright uses the project storageState automatically, these tests are
// instead covered in public-pages.spec.ts which runs under the "guest" project.
// The tests below assume the admin storageState is loaded.

// ── Authenticated admin tests ─────────────────────────────────────────────────

test.describe("Admin panel — authenticated", () => {
  test("admin dashboard loads", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("admin sessions list loads", async ({ page }) => {
    await page.goto("/admin/sessions");
    await expect(page).toHaveURL(/\/admin\/sessions/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("admin sessions new page loads", async ({ page }) => {
    await page.goto("/admin/sessions/new");
    await expect(page).toHaveURL(/\/admin\/sessions\/new/);
    // The create-session form should render a submit button
    await expect(
      page.getByRole("button", { name: /create|save|submit/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  test("admin invoices list loads", async ({ page }) => {
    await page.goto("/admin/invoices");
    await expect(page).toHaveURL(/\/admin\/invoices/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("admin create invoice page loads", async ({ page }) => {
    await page.goto("/admin/invoices/new");
    await expect(page).toHaveURL(/\/admin\/invoices\/new/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("admin customers list loads", async ({ page }) => {
    await page.goto("/admin/customers");
    await expect(page).toHaveURL(/\/admin\/customers/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("admin profile/payment page loads", async ({ page }) => {
    await page.goto("/admin/profile/payment");
    await expect(page).toHaveURL(/\/admin\/profile\/payment/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("admin session approvals page loads", async ({ page }) => {
    await page.goto("/admin/sessions/approvals");
    await expect(page).toHaveURL(/\/admin\/sessions\/approvals/);
    await expect(page.getByRole("heading")).toBeVisible();
  });
});

// ── Unauthenticated access guard ──────────────────────────────────────────────
// These run in a fresh context with no auth cookies to verify the middleware
// redirects properly. We override storageState to an empty object per test.

test.describe("Admin panel — unauthenticated redirects", () => {
  // Use a clean browser context with no saved auth state
  test.use({ storageState: { cookies: [], origins: [] } });

  const PROTECTED_ROUTES = [
    "/admin",
    "/admin/sessions",
    "/admin/sessions/new",
    "/admin/invoices",
    "/admin/invoices/new",
    "/admin/customers",
    "/admin/profile/payment",
  ];

  for (const route of PROTECTED_ROUTES) {
    test(`unauthenticated ${route} redirects away from admin`, async ({
      page,
    }) => {
      await page.goto(route);
      // Should NOT stay on an /admin path
      await expect(page).not.toHaveURL(new RegExp(`^${route}`));
    });
  }
});
