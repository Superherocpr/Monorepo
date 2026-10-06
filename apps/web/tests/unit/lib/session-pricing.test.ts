/**
 * Unit tests for lib/session-pricing.ts: the single source of truth for what a
 * session costs. The team-rate cases guard the discount being taken off a
 * negotiated per-seat rate, which the public team link and checkout must agree on.
 */

import { describe, expect, test } from "vitest";
import {
  applyDiscountPercent,
  getSessionPricing,
  normalizeDiscountPercent,
} from "@/lib/session-pricing";

/** Minimal Supabase stand-in that returns one class_sessions row. */
function clientReturning(row: Record<string, unknown> | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return { from: () => chain } as unknown as Parameters<typeof getSessionPricing>[0];
}

const sessionRow = (discount: number | string | null) => ({
  instructor_id: "inst-1",
  discount_percent: discount,
  class_types: { name: "BLS Renewal", price: "85.00" },
});

describe("normalizeDiscountPercent", () => {
  test("treats null, undefined, zero, negatives and junk as no discount", () => {
    expect(normalizeDiscountPercent(null)).toBe(0);
    expect(normalizeDiscountPercent(undefined)).toBe(0);
    expect(normalizeDiscountPercent(0)).toBe(0);
    expect(normalizeDiscountPercent(-5)).toBe(0);
    expect(normalizeDiscountPercent("abc")).toBe(0);
  });

  test("parses numeric strings, which is how Postgres numeric columns arrive", () => {
    expect(normalizeDiscountPercent("10")).toBe(10);
  });
});

describe("applyDiscountPercent", () => {
  test("rounds to cents", () => {
    expect(applyDiscountPercent(85, 10)).toBe(76.5);
    expect(applyDiscountPercent(85, 23.52941176470588)).toBe(65);
  });

  test("returns the price untouched when there is no discount", () => {
    expect(applyDiscountPercent(85, 0)).toBe(85);
  });
});

describe("getSessionPricing", () => {
  test("applies the session discount to the catalog price", async () => {
    const result = await getSessionPricing(clientReturning(sessionRow(10)), "s1");
    expect(result).toMatchObject({ found: true, basePrice: 76.5, rawPrice: 85 });
  });

  test("a team rate replaces the catalog price AND the session discount is taken off it", async () => {
    const result = await getSessionPricing(clientReturning(sessionRow(10)), "s1", {
      teamPricePerSeat: 100,
    });
    expect(result).toMatchObject({ found: true, basePrice: 90 });
  });

  test("a team rate with no session discount is charged as quoted", async () => {
    const result = await getSessionPricing(clientReturning(sessionRow(null)), "s1", {
      teamPricePerSeat: 35,
    });
    expect(result).toMatchObject({ found: true, basePrice: 35 });
  });

  test("a $0 team rate stays free whatever the discount", async () => {
    const result = await getSessionPricing(clientReturning(sessionRow(10)), "s1", {
      teamPricePerSeat: 0,
    });
    expect(result).toMatchObject({ found: true, basePrice: 0 });
  });
});
