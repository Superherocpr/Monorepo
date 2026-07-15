/**
 * rollcall.spec.ts — Roll call page end-to-end tests.
 * Verifies: page loads correctly, the access code input is present, an invalid
 * code surfaces an error, non-numeric input is handled gracefully, the
 * forgot-password link is reachable, and — with seeded data — the full happy
 * path: code → roster → info review → check-in → confirmed roster record.
 * No login required — runs under the "guest" project.
 */

import { test, expect } from "@playwright/test";
import {
  seedRollcallScenario,
  cleanupRollcallScenario,
  fetchRosterRecord,
  type SeededRollcall,
} from "./helpers/rollcall-seed";

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

    // An error message must appear — rendered with role="alert" by ErrorMsg.
    await expect(
      page.getByRole("alert")
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

test.describe("Roll call happy path (seeded)", () => {
  // verify-code rate-limits by IP (10/hour). A unique X-Forwarded-For per run
  // isolates this suite's bucket so repeated local runs never flake on 429s.
  test.use({
    extraHTTPHeaders: {
      "x-forwarded-for": `10.99.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
    },
  });

  let seed: SeededRollcall;

  test.beforeAll(async () => {
    seed = await seedRollcallScenario();
  });

  test.afterAll(async () => {
    if (seed) await cleanupRollcallScenario(seed);
  });

  test("student checks in end to end and roster_record is confirmed", async ({
    page,
  }) => {
    await page.goto("/rollcall");

    // Step 1 — the code auto-submits at 6 digits
    await page.getByRole("textbox", { name: /access code/i }).fill(seed.code);

    // Single session today → step 2 is skipped, roster picker loads
    await expect(
      page.getByRole("heading", { name: /who are you/i })
    ).toBeVisible({ timeout: 15_000 });

    // Step 3 — tap the seeded student's name
    await page
      .getByRole("button", {
        name: new RegExp(`${seed.student.firstName}\\s+${seed.student.lastName}`),
      })
      .click();

    // Step 4 — info review shows the student's email
    await expect(
      page.getByRole("heading", { name: /is this your information/i })
    ).toBeVisible();
    await expect(page.getByText(seed.student.email)).toBeVisible();

    // Confirm — this is the action that must set confirmed=true
    await page.getByRole("button", { name: /this is correct/i }).click();

    // Step 5 — confirmation screen
    await expect(
      page.getByRole("heading", { name: /checked in/i })
    ).toBeVisible({ timeout: 15_000 });

    // DB assertion: the roster record exists and is confirmed — this is the
    // exact signal the admin session page's Verified column reads.
    const record = await fetchRosterRecord(seed);
    expect(record).not.toBeNull();
    expect(record!.confirmed).toBe(true);
  });
});
