/**
 * find-a-class.spec.ts — outcome tests for the guided class finder.
 *
 * These assert where each branch actually lands, not that the page renders. The
 * failure they exist to catch is slug drift: lib/class-recommendations.ts points
 * at class types by slug, so renaming or deactivating a class type in the admin
 * silently orphans a mapping. When that happens the result panel falls back to
 * the generic request outcome and the recommended course name disappears, which
 * is precisely what these assertions notice.
 *
 * No login required — runs under the "guest" project.
 */

import { test, expect, type Page } from "@playwright/test";

/**
 * Walks the wizard from the start screen to the job-role question.
 * @param page - The Playwright page, already on /find-a-class.
 */
async function openJobBranch(page: Page): Promise<void> {
  await page.getByRole("button", { name: /just me/i }).click();
  await page.getByRole("button", { name: /help me figure it out/i }).click();
  await page.getByRole("button", { name: /for my job/i }).click();
}

test.describe("Find a class walkthrough", () => {
  test("home page Book a Class button sends visitors into the walkthrough", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^book a class$/i }).click();
    await expect(page).toHaveURL(/\/find-a-class/);
    await expect(
      page.getByRole("heading", { name: /which class do i need/i })
    ).toBeVisible();
  });

  test("a group booking goes straight to the request form", async ({ page }) => {
    await page.goto("/find-a-class");
    await page.getByRole("link", { name: /a group or workplace/i }).click();
    await expect(page).toHaveURL(/\/request-class/);
  });

  test("people who already know skip to the schedule", async ({ page }) => {
    await page.goto("/find-a-class");
    await page.getByRole("link", { name: /i already know what i need/i }).click();
    await expect(page).toHaveURL(/\/book/);
  });

  test("clinical work recommends BLS and links to that class on the schedule", async ({
    page,
  }) => {
    await page.goto("/find-a-class");
    await openJobBranch(page);
    await page.getByRole("button", { name: /healthcare or clinical staff/i }).click();

    // The course name only renders when the mapped slug matched a live,
    // active class type. Its absence is the slug-drift failure.
    await expect(
      page.getByRole("heading", { name: /basic life support/i })
    ).toBeVisible();

    // Whether it offers dates or a request depends on the schedule, but it must
    // always offer one of the two, aimed at this specific class. The exact slug
    // suffix (e.g. "-renewals") differs between environments, so match the
    // prefix rather than a hardcoded full slug.
    const booking = page.getByRole("link", { name: /see dates and book/i });
    const request = page.getByRole("link", { name: /request this class/i });

    if (await booking.isVisible()) {
      await expect(booking).toHaveAttribute(
        "href",
        /^\/book\?class=basic-life-support-bls/
      );
    } else {
      // No dates: the request link must still carry the class slug, so the
      // form arrives with the right course pre-selected instead of blank.
      await expect(request).toHaveAttribute(
        "href",
        /^\/request-class\?class=basic-life-support-bls/
      );
    }
  });

  test("clinical work is never sent to Heartsaver", async ({ page }) => {
    await page.goto("/find-a-class");
    await openJobBranch(page);
    await page.getByRole("button", { name: /healthcare or clinical staff/i }).click();

    await expect(
      page.getByRole("heading", { name: /heartsaver/i })
    ).toHaveCount(0);
  });

  test("a workplace role that needs First Aid gets the combined course", async ({
    page,
  }) => {
    await page.goto("/find-a-class");
    await openJobBranch(page);
    await page.getByRole("button", { name: /childcare or daycare/i }).click();
    await page.getByRole("button", { name: /yes, cpr and first aid/i }).click();

    await expect(
      page.getByRole("heading", { name: /heartsaver.*first aid cpr aed/i })
    ).toBeVisible();
  });

  test("the same role without First Aid gets CPR and AED only", async ({ page }) => {
    await page.goto("/find-a-class");
    await openJobBranch(page);
    await page.getByRole("button", { name: /childcare or daycare/i }).click();
    await page.getByRole("button", { name: /no, just cpr and aed/i }).click();

    await expect(
      page.getByRole("heading", { name: /heartsaver.*cpr aed/i })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /first aid cpr aed/i })
    ).toHaveCount(0);
  });

  test("an unlisted job is routed to a request instead of a guess", async ({
    page,
  }) => {
    await page.goto("/find-a-class");
    await openJobBranch(page);
    await page.getByRole("button", { name: /something else/i }).click();

    await expect(
      page.getByRole("link", { name: /request a class/i })
    ).toHaveAttribute("href", "/request-class");
  });

  test("personal learners who need no card get the non-certified course", async ({
    page,
  }) => {
    await page.goto("/find-a-class");
    await page.getByRole("button", { name: /just me/i }).click();
    await page.getByRole("button", { name: /help me figure it out/i }).click();
    await page.getByRole("button", { name: /for myself or my family/i }).click();
    await page.getByRole("button", { name: /^cpr and aed/i }).click();
    await page.getByRole("button", { name: /no, i just want to learn/i }).click();

    await expect(
      page.getByRole("heading", { name: /family.*friends.*cpr/i })
    ).toBeVisible();
  });

  test("back returns to the previous question with answers intact", async ({
    page,
  }) => {
    await page.goto("/find-a-class");
    await openJobBranch(page);
    await expect(
      page.getByRole("heading", { name: /what kind of work do you do/i })
    ).toBeVisible();

    await page.getByRole("button", { name: /^back$/i }).click();
    await expect(
      page.getByRole("heading", { name: /why do you need this training/i })
    ).toBeVisible();
  });

  test("start over clears the walkthrough", async ({ page }) => {
    await page.goto("/find-a-class");
    await openJobBranch(page);
    await page.getByRole("button", { name: /healthcare or clinical staff/i }).click();
    await page.getByRole("button", { name: /start over/i }).click();

    await expect(
      page.getByRole("heading", { name: /who is this class for/i })
    ).toBeVisible();
  });

  test("no availability count or date is shown before the final result", async ({
    page,
  }) => {
    // Regression: this text used to appear on every class-list row, including
    // "no dates" for classes with nothing scheduled. Seeing that partway
    // through the walkthrough gave a visitor a reason to leave before ever
    // reaching a recommendation, for no benefit — they cannot act on it yet.
    await page.goto("/find-a-class");
    await page.getByRole("button", { name: /just me/i }).click();
    await page.getByRole("button", { name: /i know the course name/i }).click();

    await expect(
      page.getByText(/no dates on the public schedule/i)
    ).toHaveCount(0);
    await expect(page.getByText(/upcoming date/i)).toHaveCount(0);
  });

  test("the final result never shows an availability count or date either", async ({
    page,
  }) => {
    // The routing decision (book vs. request) still depends on availability,
    // but the number and next date are never rendered, even at the end.
    await page.goto("/find-a-class");
    await openJobBranch(page);
    await page.getByRole("button", { name: /healthcare or clinical staff/i }).click();
    await expect(
      page.getByRole("heading", { name: /basic life support/i })
    ).toBeVisible();

    await expect(
      page.getByText(/no dates on the public schedule/i)
    ).toHaveCount(0);
    await expect(page.getByText(/upcoming date/i)).toHaveCount(0);
  });

  test("Request this class carries the course into the request form", async ({
    page,
  }) => {
    // Family & Friends CPR is named identically on every environment, so its
    // slug is stable to assert against here.
    await page.goto("/request-class?class=family-friends-cpr");

    const select = page.locator("#class_type_id");
    const selectedLabel = await select
      .locator("option:checked")
      .textContent();
    expect(selectedLabel).toMatch(/family.*friends.*cpr/i);
  });

  test("an unrecognised class slug leaves the request form type unset", async ({
    page,
  }) => {
    await page.goto("/request-class?class=not-a-real-class");

    await expect(page.locator("#class_type_id")).toHaveValue("");
  });
});
