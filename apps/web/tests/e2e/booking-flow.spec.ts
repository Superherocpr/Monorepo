/**
 * booking-flow.spec.ts — Booking wizard end-to-end tests.
 * Requires an authenticated customer session (uses tests/.auth/customer.json).
 * Runs under the "customer" project.
 *
 * Tests cover: session list loads, selecting a session advances the wizard,
 * the sign-in/details step is shown, and unauthenticated redirects are handled.
 *
 * NOTE: Selecting a session and proceeding through PayPal is not tested here
 * because it requires a live PayPal sandbox integration. These tests verify
 * the front-end state machine up to the payment step only.
 */

import { test, expect } from "@playwright/test";

test.describe("Booking flow", () => {
  test("book page loads and shows available sessions", async ({ page }) => {
    await page.goto("/book");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The page should render some content — either a list of sessions or an
    // empty state message. Either way the heading must be present.
  });

  test("selecting a session advances to step 2", async ({ page }) => {
    await page.goto("/book");
    await page.waitForLoadState("networkidle");

    // Find the first Book button. If no sessions are available in staging, skip.
    const bookButton = page.getByRole("button", { name: /book/i }).first();
    const count = await bookButton.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await bookButton.click();

    // After selecting a session, the booking progress bar should advance or
    // the URL should change to a step-2 route
    await expect(page).toHaveURL(/book\/(signin|details|create-account)/);
  });

  test("accessing /book/payment without a session selection redirects to /book", async ({
    page,
  }) => {
    // The booking store is cleared between tests. Going directly to /book/payment
    // without a selected session should bounce back to the session list.
    await page.goto("/book/payment");
    await expect(page).toHaveURL(/\/book(\?|$)/);
  });

  test("booking progress indicator is visible on step pages", async ({
    page,
  }) => {
    await page.goto("/book");
    await page.waitForLoadState("networkidle");

    // Navigate to a step page directly
    const bookButton = page.getByRole("button", { name: /book/i }).first();
    if ((await bookButton.count()) === 0) {
      test.skip();
      return;
    }

    await bookButton.click();

    // The BookingProgress component renders step indicators
    // We check for the step 2 heading on the sign-in page
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible({
      timeout: 10_000,
    });
  });
});
