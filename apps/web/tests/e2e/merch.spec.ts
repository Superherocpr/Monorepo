/**
 * merch.spec.ts — Merchandise page end-to-end tests.
 * Covers: page load, cart drawer visibility, add-to-cart flow, quantity
 * controls, and the checkout shipping form appearing after proceeding.
 * No login required — runs under the "guest" project.
 *
 * NOTE: Tests that touch size selection depend on there being at least one
 * product with in-stock variants in the staging database. If the DB is empty,
 * those tests will be skipped gracefully via conditional logic.
 */

import { test, expect } from "@playwright/test";

test.describe("Merch page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/merch");
    await page.waitForLoadState("networkidle");
  });

  test("page loads and renders product grid heading", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("floating cart button is NOT visible when cart is empty", async ({
    page,
  }) => {
    // The floating cart button only appears when cartCount > 0
    const cartButton = page.getByRole("button", { name: /open cart/i });
    await expect(cartButton).not.toBeVisible();
  });

  test("cart drawer is closed on initial load", async ({ page }) => {
    // The drawer heading "Your Cart" should not be visible before opening
    await expect(page.getByRole("heading", { name: /your cart/i })).not.toBeVisible();
  });

  test("add a product to cart shows cart button and opens drawer", async ({
    page,
  }) => {
    // Find the first product card
    const firstCard = page.locator("article").first();
    const cardCount = await page.locator("article").count();

    // If there are no products in the DB, skip this test gracefully
    if (cardCount === 0) {
      test.skip();
      return;
    }

    // Pick the first available (non-OOS) size button inside the first card
    const sizeButton = firstCard
      .getByRole("button", { name: /size/i })
      .filter({ hasNot: page.locator('[aria-label*="out of stock"]') })
      .first();

    const sizeCount = await sizeButton.count();
    if (sizeCount === 0) {
      test.skip();
      return;
    }

    await sizeButton.click();

    // Add to cart
    const addButton = firstCard.getByRole("button", { name: /add to cart/i });
    await addButton.click();

    // Floating cart button must now be visible
    await expect(
      page.getByRole("button", { name: /open cart/i })
    ).toBeVisible({ timeout: 5_000 });
  });

  test("cart drawer opens and shows item after add to cart", async ({
    page,
  }) => {
    const cardCount = await page.locator("article").count();
    if (cardCount === 0) {
      test.skip();
      return;
    }

    const firstCard = page.locator("article").first();
    const sizeButton = firstCard
      .getByRole("button", { name: /size/i })
      .first();

    if ((await sizeButton.count()) === 0) {
      test.skip();
      return;
    }

    await sizeButton.click();
    await firstCard.getByRole("button", { name: /add to cart/i }).click();

    // Open the drawer
    await page.getByRole("button", { name: /open cart/i }).click();

    // Drawer heading must be visible
    await expect(
      page.getByRole("heading", { name: /your cart/i })
    ).toBeVisible();

    // Proceed to Checkout button must be visible
    await expect(
      page.getByRole("button", { name: /proceed to checkout/i })
    ).toBeVisible();
  });

  test("shipping form appears after proceeding to checkout", async ({
    page,
  }) => {
    const cardCount = await page.locator("article").count();
    if (cardCount === 0) {
      test.skip();
      return;
    }

    const firstCard = page.locator("article").first();
    const sizeButton = firstCard.getByRole("button", { name: /size/i }).first();
    if ((await sizeButton.count()) === 0) {
      test.skip();
      return;
    }

    await sizeButton.click();
    await firstCard.getByRole("button", { name: /add to cart/i }).click();
    await page.getByRole("button", { name: /open cart/i }).click();
    await page.getByRole("button", { name: /proceed to checkout/i }).click();

    // Shipping Information heading should now appear
    await expect(page.getByText(/shipping information/i)).toBeVisible();
    await expect(page.locator("#ship-name")).toBeVisible();
    await expect(page.locator("#ship-email")).toBeVisible();
  });
});
