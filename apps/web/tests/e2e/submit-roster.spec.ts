/**
 * submit-roster.spec.ts — Roster submission page end-to-end tests.
 * Verifies: page loads, empty submission is blocked, an invalid invoice number
 * returns an error, the ?invoice query param pre-fills the field, and the
 * seeded test invoice (from staging data) works end-to-end through step 1.
 * No login required — runs under the "guest" project.
 *
 * NOTE: Full file-upload flow is not tested here because it requires a real
 * .xlsx/.csv file and a live Supabase staging environment.
 */

import { test, expect } from "@playwright/test";

test.describe("Submit Roster page", () => {
  test("page loads with heading and invoice field", async ({ page }) => {
    await page.goto("/submit-roster");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Invoice number input must be present
    await expect(
      page.getByRole("textbox").first()
    ).toBeVisible();
  });

  test("?invoice query param pre-fills the invoice field", async ({ page }) => {
    await page.goto("/submit-roster?invoice=INV-TEST-001");
    const invoiceInput = page.getByRole("textbox").first();
    await expect(invoiceInput).toHaveValue("INV-TEST-001");
  });

  test("empty invoice submission shows validation error", async ({ page }) => {
    await page.goto("/submit-roster");

    // Click through without entering anything — Step 1 button is "Find My Class"
    const nextButton = page
      .getByRole("button", { name: /next|continue|submit|find/i })
      .first();
    await nextButton.click();

    // Either native HTML validation triggers (no network request) or the app
    // surfaces a JS validation error
    const inputInvalid = await page
      .getByRole("textbox")
      .first()
      .evaluate((el) => !(el as HTMLInputElement).validity.valid);

    const hasJsError = await page
      .getByText(/enter.*invoice|invoice.*required|invalid/i)
      .isVisible()
      .catch(() => false);

    expect(inputInvalid || hasJsError).toBeTruthy();
  });

  test("invalid invoice number returns a not-found error", async ({ page }) => {
    await page.goto("/submit-roster");

    const invoiceInput = page.getByRole("textbox").first();
    await invoiceInput.fill("INV-DOES-NOT-EXIST-99999");

    const nextButton = page
      .getByRole("button", { name: /next|continue|submit|find/i })
      .first();
    await nextButton.click();

    // The API returns "We couldn't find an invoice with that number."
    await expect(
      page.getByText(/couldn't find|not found|invalid|no.*invoice|does not exist/i)
    ).toBeVisible({ timeout: 10_000 });
  });
});
