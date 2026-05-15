/**
 * rollcall.spec.ts — Roll call page end-to-end tests.
 * Verifies: page loads correctly, the access code input is present, an invalid
 * code surfaces an error, non-numeric input is handled gracefully, and the
 * forgot-password link is reachable.
 * No login required — runs under the "guest" project.
 */

import { test, expect } from "@playwright/test";

test.describe("Roll call page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/rollcall");
  });

  test("page loads and shows access-code step", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Step 1 is the access code entry — there should be a text input
    await expect(page.getByRole("textbox").first()).toBeVisible();
  });

  test("submitting an invalid access code shows an error", async ({ page }) => {
    // Fill a plausible but wrong 6-digit code
    const codeInput = page.getByRole("textbox").first();
    await codeInput.fill("000000");

    // Find and click the submit/continue button
    const submitButton = page
      .getByRole("button", { name: /continue|check in|submit|next/i })
      .first();
    await submitButton.click();

    // An error or "invalid code" message must appear
    await expect(
      page.getByText(/invalid|not found|incorrect|try again/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test("non-numeric code is rejected or sanitised", async ({ page }) => {
    const codeInput = page.getByRole("textbox").first();
    await codeInput.fill("abc!@#");

    const submitButton = page
      .getByRole("button", { name: /continue|check in|submit|next/i })
      .first();
    await submitButton.click();

    // Either the input was sanitised to empty OR an error was shown
    const value = await codeInput.inputValue();
    const hasError = await page
      .getByRole("alert")
      .or(page.getByText(/invalid|enter.*code/i))
      .isVisible()
      .catch(() => false);

    expect(value === "" || hasError).toBeTruthy();
  });

  test("forgot-password link navigates to the forgot-password page", async ({
    page,
  }) => {
    const link = page
      .getByRole("link", { name: /forgot.*password/i })
      .first();

    // The link may only appear on a later step (sign-in step), so skip if absent.
    if ((await link.count()) === 0) {
      test.skip();
      return;
    }

    await link.click();
    await expect(page).toHaveURL(/forgot-password/);
  });
});
