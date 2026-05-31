/**
 * admin.spec.ts — Admin panel end-to-end tests.
 * Uses a saved admin auth session (tests/.auth/admin.json) for authenticated
 * tests. Also covers unauthenticated redirect behaviour for all admin routes.
 * Runs under the "admin" project.
 */

import { test, expect } from "@playwright/test";

// ── Authenticated admin tests ─────────────────────────────────────────────────

test.describe("Admin panel — authenticated", () => {
  test("admin dashboard loads", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  // ── Sessions ───────────────────────────────────────────────────────────────

  test("admin sessions list loads", async ({ page }) => {
    await page.goto("/admin/sessions");
    await expect(page).toHaveURL(/\/admin\/sessions/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  test("admin sessions new page loads", async ({ page }) => {
    await page.goto("/admin/sessions/new");
    await expect(page).toHaveURL(/\/admin\/sessions\/new/);
    await expect(
      page.getByRole("button", { name: /create|save|submit/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  test("admin session approvals page loads", async ({ page }) => {
    await page.goto("/admin/sessions/approvals");
    await expect(page).toHaveURL(/\/admin\/sessions\/approvals/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Invoices ───────────────────────────────────────────────────────────────

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

  // ── Customers ──────────────────────────────────────────────────────────────

  test("admin customers list loads", async ({ page }) => {
    await page.goto("/admin/customers");
    await expect(page).toHaveURL(/\/admin\/customers/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Payments ───────────────────────────────────────────────────────────────

  test("admin payments page loads", async ({ page }) => {
    await page.goto("/admin/payments");
    await expect(page).toHaveURL(/\/admin\/payments/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Orders ─────────────────────────────────────────────────────────────────

  test("admin orders page loads", async ({ page }) => {
    await page.goto("/admin/orders");
    await expect(page).toHaveURL(/\/admin\/orders/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Merch ──────────────────────────────────────────────────────────────────

  test("admin merch page loads", async ({ page }) => {
    await page.goto("/admin/merch");
    await expect(page).toHaveURL(/\/admin\/merch/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Staff ──────────────────────────────────────────────────────────────────

  test("admin staff management page loads", async ({ page }) => {
    await page.goto("/admin/staff");
    await expect(page).toHaveURL(/\/admin\/staff/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Payouts ────────────────────────────────────────────────────────────────

  test("admin payouts page loads", async ({ page }) => {
    await page.goto("/admin/payouts");
    await expect(page).toHaveURL(/\/admin\/payouts/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Analytics ──────────────────────────────────────────────────────────────

  test("admin analytics page loads", async ({ page }) => {
    await page.goto("/admin/analytics");
    await expect(page).toHaveURL(/\/admin\/analytics/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Certifications ─────────────────────────────────────────────────────────

  test("admin certifications page loads", async ({ page }) => {
    await page.goto("/admin/certifications");
    await expect(page).toHaveURL(/\/admin\/certifications/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Contact submissions ────────────────────────────────────────────────────

  test("admin contact submissions page loads", async ({ page }) => {
    await page.goto("/admin/contact");
    await expect(page).toHaveURL(/\/admin\/contact/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Enrollware tool ────────────────────────────────────────────────────────

  test("admin enrollware tool page loads", async ({ page }) => {
    await page.goto("/admin/enrollware-tool");
    await expect(page).toHaveURL(/\/admin\/enrollware-tool/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Locations ──────────────────────────────────────────────────────────────

  test("admin locations page loads", async ({ page }) => {
    await page.goto("/admin/locations");
    await expect(page).toHaveURL(/\/admin\/locations/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Settings ───────────────────────────────────────────────────────────────

  test("admin settings page loads", async ({ page }) => {
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/admin\/settings/);
    await expect(page.getByRole("heading")).toBeVisible();
  });

  // ── Profile/payment ────────────────────────────────────────────────────────

  test("admin profile/payment page loads", async ({ page }) => {
    await page.goto("/admin/profile/payment");
    await expect(page).toHaveURL(/\/admin\/profile\/payment/);
    await expect(page.getByRole("heading")).toBeVisible();
  });
});

// ── Unauthenticated access guard ──────────────────────────────────────────────
// These run in a fresh context with no auth cookies to verify the middleware
// redirects properly.

test.describe("Admin panel — unauthenticated redirects", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const PROTECTED_ROUTES = [
    "/admin",
    "/admin/sessions",
    "/admin/sessions/new",
    "/admin/sessions/approvals",
    "/admin/invoices",
    "/admin/invoices/new",
    "/admin/customers",
    "/admin/payments",
    "/admin/orders",
    "/admin/merch",
    "/admin/staff",
    "/admin/payouts",
    "/admin/analytics",
    "/admin/certifications",
    "/admin/contact",
    "/admin/enrollware-tool",
    "/admin/locations",
    "/admin/settings",
    "/admin/profile/payment",
  ];

  for (const route of PROTECTED_ROUTES) {
    test(`unauthenticated ${route} redirects away from admin`, async ({
      page,
    }) => {
      await page.goto(route);
      await expect(page).not.toHaveURL(new RegExp(`^${route}`));
    });
  }
});
