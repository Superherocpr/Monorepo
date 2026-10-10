/**
 * admin-theme.spec.ts: the staff-only dark theme must never reach customer pages.
 *
 * WHY THIS FILE EXISTS
 *   Dark mode used to be a global setting: a staff member who turned it on got a
 *   dark page (white-themed content on a dark canvas) on /rollcall and the rest of
 *   the public site, on that device. This test plants every localStorage value the
 *   old and new implementations ever read, then asserts customer-facing pages still
 *   render light. It asserts outcomes (computed colors, absent theme wrapper), not
 *   that the page merely loads.
 *
 * No login required: runs under the "guest" project.
 */

import { test, expect } from "@playwright/test";

const CUSTOMER_PAGES = ["/", "/rollcall", "/find-a-class", "/signin"];

test.describe("Staff dark mode does not leak onto customer pages", () => {
  for (const path of CUSTOMER_PAGES) {
    test(`${path} stays light when dark is stored`, async ({ page }) => {
      // Runs before any page script, so it applies from first paint.
      await page.addInitScript(() => {
        localStorage.setItem("admin-theme", "dark"); // current key
        localStorage.setItem("theme", "dark"); // legacy global key
      });
      await page.goto(path);

      const state = await page.evaluate(() => ({
        htmlHasDarkClass: document.documentElement.classList.contains("dark"),
        hasThemeWrapper: document.querySelector("[data-admin-theme]") !== null,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
      }));

      expect(state.htmlHasDarkClass).toBe(false);
      expect(state.hasThemeWrapper).toBe(false);
      expect(state.bodyBackground).toBe("rgb(255, 255, 255)");
      expect(state.colorScheme).toBe("normal");
    });
  }

  test("an OS dark preference alone does not darken customer pages", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/rollcall");
    const bodyBackground = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    expect(bodyBackground).toBe("rgb(255, 255, 255)");
    await context.close();
  });
});
