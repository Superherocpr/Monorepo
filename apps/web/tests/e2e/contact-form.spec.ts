/**
 * contact-form.spec.ts — Contact form validation and submission tests.
 * Verifies that empty submits are blocked client-side, that all required
 * fields are labelled correctly, and that partial fills surface the right error.
 * No login required — runs under the "guest" project.
 */

import { test, expect } from "@playwright/test";

test.describe("Contact form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/contact");
    // Wait for the form's submit button to be visible before each test
    await page.getByRole("button", { name: /send/i }).waitFor();
  });

  test("blocks empty submission and shows validation message", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /send/i }).click();

    // Client-side guard must show an error — not silently fail or POST
    await expect(
      page.getByText(/fill in all required|required fields/i)
    ).toBeVisible({ timeout: 5_000 });
  });

  test("all required field labels are present", async ({ page }) => {
    await expect(page.getByLabel(/name/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/phone/i)).toBeVisible();
    await expect(page.getByLabel(/message/i)).toBeVisible();
  });

  test("partial fill still blocks submission", async ({ page }) => {
    // Fill only name and email — phone and message missing
    await page.getByLabel(/name/i).fill("Test Person");
    await page.getByLabel(/email/i).fill("test@example.com");
    await page.getByRole("button", { name: /send/i }).click();

    await expect(
      page.getByText(/fill in all required|required fields/i)
    ).toBeVisible({ timeout: 5_000 });
  });

  test("error clears after filling all fields", async ({ page }) => {
    // Trigger the error first
    await page.getByRole("button", { name: /send/i }).click();
    await expect(
      page.getByText(/fill in all required|required fields/i)
    ).toBeVisible();

    // Now fill all required fields — the error should either clear or
    // a new network request is made (we just confirm the old error isn't stuck)
    await page.getByLabel(/name/i).fill("Test Person");
    await page.getByLabel(/email/i).fill("test@example.com");
    await page.getByLabel(/phone/i).fill("555-0100");
    await page.getByLabel(/message/i).fill("This is a test message.");

    // Find the inquiry type selector and pick the first non-empty option
    const inquirySelect = page.locator("select");
    if (await inquirySelect.count() > 0) {
      await inquirySelect.selectOption({ index: 1 });
    }

    // After filling everything, clicking send should NOT show the "fill in all"
    // error. It will attempt a real POST, which may succeed or fail with a server
    // error in test environment — but the client-side guard must be gone.
    await page.getByRole("button", { name: /send/i }).click();
    await expect(
      page.getByText(/fill in all required|required fields/i)
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
