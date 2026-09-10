/**
 * request-class-venue.spec.ts — outcome test for the home-base venue option
 * on /request-class (migration 0069).
 *
 * Drives the real submit flow as an authenticated customer, then reads the
 * created row directly with a service-role client to confirm the two things
 * that matter and are not otherwise visible in the UI: travel_fee = 0 and
 * venue_mode = 'home_base'. A UI-only assertion (the success screen appeared)
 * would not catch a bug that submitted the right screen with the wrong data —
 * e.g. defaulting back to travel_fee = 65 while still saying "no fee" on screen.
 *
 * Requires an authenticated customer session (uses tests/.auth/customer.json).
 * Runs under the "customer" project. Relies on the seed "Home Base" location
 * in Tampa, FL (id 00000000-0000-0000-0000-00000000d001) always existing on
 * staging, the same assumption rollcall-seed.ts makes about reusing seed rows
 * rather than inserting new ones.
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./helpers/rollcall-seed";

/** Returns YYYY-MM-DD for `days` days from today — must clear the 7-day minimum. */
function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

test.describe("Request a class — home base venue", () => {
  test("submitting with a home-base location writes travel_fee 0 and venue_mode home_base", async ({
    page,
  }) => {
    // A marker in notes makes the row unambiguous to find and clean up,
    // without relying on being the only request submitted around this time.
    const marker = `e2e-home-base-${Date.now()}`;

    await page.goto("/request-class");

    await page.locator("#class_type_id").selectOption({ index: 1 });
    await page.locator("#preferred_date").fill(futureDate(10));
    await page.locator("#preferred_time_of_day").selectOption("flexible");
    await page.locator("#group_size").fill("5");
    await page.locator("#contact_phone").fill("(555) 555-5555");

    // Only rendered when at least one home-base location exists.
    await page.getByRole("button", { name: /one of your locations/i }).click();
    await page
      .locator("#venue_location_id")
      .selectOption({ label: "Tampa, FL" });

    await page.locator("#notes").fill(marker);

    await page.getByRole("button", { name: /submit request/i }).click();

    await expect(
      page.getByRole("heading", { name: /request submitted/i })
    ).toBeVisible({ timeout: 15_000 });

    // ── Verify the actual row, not just the screen ──────────────────────────
    const db = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const { data: row } = await db
      .from("class_requests")
      .select(
        "id, venue_mode, venue_location_id, venue_name, venue_city, venue_state, travel_fee"
      )
      .eq("notes", marker)
      .single();

    expect(row).toBeTruthy();
    expect(row?.venue_mode).toBe("home_base");
    expect(row?.venue_location_id).toBe("00000000-0000-0000-0000-00000000d001");
    expect(row?.venue_name).toBeNull();
    expect(row?.venue_city).toBe("Tampa");
    expect(row?.venue_state).toBe("FL");
    expect(Number(row?.travel_fee)).toBe(0);

    // Clean up: a pending request with no session yet, safe to delete outright.
    if (row) {
      await db.from("class_requests").delete().eq("id", row.id);
    }
  });
});
