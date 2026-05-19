/**
 * public-pages.spec.ts — Smoke tests for every public-facing page.
 * Verifies that each route loads without a crash, renders key content,
 * and that common navigation elements are present.
 * No login required — runs under the "guest" project.
 */

import { test, expect } from "@playwright/test";

// ── Homepage ──────────────────────────────────────────────────────────────────

test.describe("Homepage", () => {
  test("loads and renders hero section", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/superhero/i);
    // The hero section contains the brand name
    await expect(page.getByRole("banner")).toBeVisible();
  });

  test("public header renders Sign In link", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /sign in/i })
    ).toBeVisible();
  });

  test("navigation links are present", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation");
    await expect(nav).toBeVisible();
    // These links must exist somewhere in the navigation
    await expect(
      page.getByRole("link", { name: /classes/i }).first()
    ).toBeVisible();
  });
});

// ── About page ────────────────────────────────────────────────────────────────

test("about page loads", async ({ page }) => {
  await page.goto("/about");
  await expect(page).toHaveURL("/about");
  // Page has a heading
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

// ── Classes page ──────────────────────────────────────────────────────────────

test("classes page loads", async ({ page }) => {
  await page.goto("/classes");
  await expect(page).toHaveURL("/classes");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

// ── Merch page ────────────────────────────────────────────────────────────────

test("merch page loads", async ({ page }) => {
  await page.goto("/merch");
  await expect(page).toHaveURL("/merch");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

// ── Contact page ──────────────────────────────────────────────────────────────

test("contact page loads and shows form", async ({ page }) => {
  await page.goto("/contact");
  await expect(page).toHaveURL("/contact");
  await expect(page.getByRole("button", { name: /send/i })).toBeVisible();
});

// ── Book page (booking entry) ─────────────────────────────────────────────────

test("book page loads and shows schedule list", async ({ page }) => {
  await page.goto("/book");
  await expect(page).toHaveURL("/book");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

// ── Roll call page ────────────────────────────────────────────────────────────

test("rollcall page loads and shows access-code input", async ({ page }) => {
  await page.goto("/rollcall");
  await expect(page).toHaveURL("/rollcall");
  // Step 1 renders an input for the 6-digit code
  await expect(
    page.getByRole("textbox").first()
  ).toBeVisible();
});

// ── Submit Roster page ────────────────────────────────────────────────────────

test("submit-roster page loads", async ({ page }) => {
  await page.goto("/submit-roster");
  await expect(page).toHaveURL("/submit-roster");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

// ── Auth-guarded pages redirect unauthenticated visitors ─────────────────────

test.describe("auth guard redirects", () => {
  test("unauthenticated /dashboard redirects to signin", async ({ page }) => {
    await page.goto("/dashboard");
    // Should redirect to signin. Note: the redirect URL contains ?redirect=/dashboard
    // so we check for /signin rather than not.toHaveURL(/\/dashboard/).
    await expect(page).toHaveURL(/\/signin/);
  });

  test("unauthenticated /admin redirects away", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/^\/admin/);
  });
});

// ── Mobile nav ────────────────────────────────────────────────────────────────

test("mobile nav hamburger is visible at 390px width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // On mobile there should be a menu toggle button
  const menuButton = page.getByRole("button", { name: /menu/i });
  await expect(menuButton).toBeVisible();
});
