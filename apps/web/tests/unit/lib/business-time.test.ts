/**
 * Unit tests for lib/business-time.ts
 *
 * Covers: businessDate formatting across the UTC/Eastern day boundary (the
 * exact bug that made evening classes vanish from rollcall) and DST offsets,
 * plus isSameBusinessDay on both sides of midnight ET.
 */
import { describe, test, expect } from "vitest";
import { businessDate, isSameBusinessDay } from "@/lib/business-time";

describe("businessDate", () => {
  test("formats as YYYY-MM-DD", () => {
    expect(businessDate(new Date("2026-07-15T12:00:00Z"))).toBe("2026-07-15");
  });

  test("an instant after UTC midnight is still the previous Eastern day (EDT)", () => {
    // 00:15 UTC Jul 16 = 8:15 PM EDT Jul 15 — the evening-class bug case
    expect(businessDate(new Date("2026-07-16T00:15:00Z"))).toBe("2026-07-15");
  });

  test("handles EST (winter, UTC-5)", () => {
    // 04:59 UTC Jan 10 = 11:59 PM EST Jan 9
    expect(businessDate(new Date("2026-01-10T04:59:00Z"))).toBe("2026-01-09");
    // 05:00 UTC Jan 10 = midnight EST Jan 10
    expect(businessDate(new Date("2026-01-10T05:00:00Z"))).toBe("2026-01-10");
  });

  test("handles EDT (summer, UTC-4)", () => {
    // 03:59 UTC Jul 16 = 11:59 PM EDT Jul 15
    expect(businessDate(new Date("2026-07-16T03:59:00Z"))).toBe("2026-07-15");
    // 04:00 UTC Jul 16 = midnight EDT Jul 16
    expect(businessDate(new Date("2026-07-16T04:00:00Z"))).toBe("2026-07-16");
  });
});

describe("isSameBusinessDay", () => {
  test("morning and late evening of the same Eastern day match", () => {
    // 9 AM EDT and 11 PM EDT on Jul 15 (the latter is Jul 16 in UTC)
    const morning = new Date("2026-07-15T13:00:00Z");
    const lateEvening = new Date("2026-07-16T03:00:00Z");
    expect(isSameBusinessDay(morning, lateEvening)).toBe(true);
  });

  test("instants across midnight ET do not match", () => {
    const beforeMidnight = new Date("2026-07-16T03:59:00Z"); // 11:59 PM EDT Jul 15
    const afterMidnight = new Date("2026-07-16T04:01:00Z"); // 12:01 AM EDT Jul 16
    expect(isSameBusinessDay(beforeMidnight, afterMidnight)).toBe(false);
  });
});
