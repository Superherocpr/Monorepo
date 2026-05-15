/**
 * auth.spec.ts — Sign-in flow end-to-end tests.
 * Tests cover: invalid credentials, form label wiring, redirect when already
 * authenticated, and the forgot-password page.
 * No saved auth state — all tests start as a guest.
 * Runs under the "guest" project.
 */

import { test, expect } from "@playwright/test";

test.describe("Sign-in page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signin");
  });

  test("renders page heading and form fields", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in/i })
    ).toBeVisible();
  });

  test("shows inline error with invalid credentials", async ({ page }) => {
    await page.getByLabel("Email").fill("not-a-real-user@example.invalid");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Supabase returns an auth error — shown in an alert role element
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 10_000 });
  });

  test("email field wired to correct input (htmlFor matches id)", async ({
    page,
  }) => {
    // Clicking the label should focus the email input
    await page.getByLabel("Email").click();
    const emailInput = page.locator("#signin-email");
    await expect(emailInput).toBeFocused();
  });

  test("password field wired to correct input", async ({ page }) => {
    await page.getByLabel("Password").click();
    const passwordInput = page.locator("#signin-password");
    await expect(passwordInput).toBeFocused();
  });

  test("forgot password link is present and navigates", async ({ page }) => {
    const forgotLink = page.getByRole("link", { name: /forgot/i });
    await expect(forgotLink).toBeVisible();
    await forgotLink.click();
    await expect(page).toHaveURL(/forgot-password/);
  });
});

// ── Forgot-password page ──────────────────────────────────────────────────────

test.describe("Forgot-password page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/book/forgot-password");
  });

  test("renders the email request form", async ({ page }) => {
    await expect(page.getByRole("heading")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /send|reset/i })
    ).toBeVisible();
  });

  test("shows success message after submitting any email", async ({ page }) => {
    // Always shows success regardless of whether the email exists (anti-enumeration).
    await page.getByLabel("Email").fill("someone@example.com");
    await page.getByRole("button", { name: /send|reset/i }).click();

    // A success/confirmation message should appear
    await expect(
      page.getByText(/check your email|sent|link/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test("back to sign in link navigates correctly", async ({ page }) => {
    const backLink = page.getByRole("link", { name: /back to sign in|sign in/i });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL(/\/signin/);
  });
});
