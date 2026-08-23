/**
 * Unit tests for lib/business-time.ts
 *
 * Covers two distinct contracts:
 *
 *   1. Floating class times — the wall clock an instructor typed must survive a
 *      store/read round trip unchanged, and must render identically no matter
 *      what timezone the process runs in. The regression these guard against is
 *      the reported bug: a 9:00 AM class showing as 1:00 PM in the confirmation
 *      email because the email renders on a UTC server.
 *
 *   2. businessDate / isSameBusinessDay — real instants resolved to the business
 *      calendar day, across the UTC/Eastern boundary (the bug that made evening
 *      classes vanish from rollcall) and both DST offsets.
 */
import { describe, test, expect } from "vitest";
import {
  businessDate,
  isSameBusinessDay,
  toFloatingISO,
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
  addFloatingMinutes,
  formatClassDate,
  formatClassTime,
  formatClassTimeRange,
  formatClassDateTimeLong,
  formatClassDateTimeShort,
  classDate,
  floatingNow,
  msUntilClass,
} from "@/lib/business-time";

describe("floating class times — store and read back verbatim", () => {
  test("the entered wall clock is what gets stored", () => {
    expect(toFloatingISO("2026-09-14", "09:00")).toBe("2026-09-14T09:00:00.000Z");
    expect(toFloatingISO("2026-09-14", "17:30")).toBe("2026-09-14T17:30:00.000Z");
  });

  test("a 9:00 AM class reads back as 9:00 AM", () => {
    const stored = toFloatingISO("2026-09-14", "09:00");
    expect(formatClassTime(stored)).toBe("9:00 AM");
  });

  test("the reported bug: 9:00 AM never renders as 1:00 PM", () => {
    // Before the fix this row was stored as 13:00Z and rendered in UTC on the
    // email server, producing "1:00 PM" for a 9:00 AM class.
    const stored = toFloatingISO("2026-09-14", "09:00");
    expect(formatClassTime(stored)).not.toBe("1:00 PM");
  });

  test("datetime-local round trip is exact", () => {
    const stored = toFloatingISO("2026-09-14", "17:30");
    const forInput = toDatetimeLocalValue(stored);
    expect(forInput).toBe("2026-09-14T17:30");
    expect(fromDatetimeLocalValue(forInput)).toBe(stored);
  });

  test("editing a session and saving it back does not drift the time", () => {
    // Re-saving an unchanged session must be a no-op — the old local-timezone
    // round trip shifted the time by the UTC offset on every save.
    let stored = toFloatingISO("2026-01-15", "08:00");
    for (let i = 0; i < 5; i++) {
      stored = fromDatetimeLocalValue(toDatetimeLocalValue(stored));
    }
    expect(formatClassTime(stored)).toBe("8:00 AM");
  });

  test("adding a class duration keeps the wall clock floating", () => {
    const start = toFloatingISO("2026-09-14", "09:00");
    const end = addFloatingMinutes(start, 120);
    expect(formatClassTimeRange(start, end)).toBe("9:00 AM – 11:00 AM");
  });

  test("a duration crossing midnight rolls the date correctly", () => {
    const start = toFloatingISO("2026-09-14", "23:00");
    const end = addFloatingMinutes(start, 120);
    expect(classDate(end)).toBe("2026-09-15");
    expect(formatClassTime(end)).toBe("1:00 AM");
  });

  test("classDate reads the calendar day with no conversion", () => {
    // 8:00 AM would shift to the previous day if this were converted to Eastern.
    expect(classDate(toFloatingISO("2026-09-14", "08:00"))).toBe("2026-09-14");
    // 11:00 PM would shift to the next day if converted the other way.
    expect(classDate(toFloatingISO("2026-09-14", "23:00"))).toBe("2026-09-14");
  });

  test("date formatting variants", () => {
    const stored = toFloatingISO("2026-09-14", "09:00");
    expect(formatClassDate(stored)).toBe("Monday, September 14, 2026");
    expect(formatClassDate(stored, { month: "short" })).toBe("Monday, Sep 14, 2026");
    expect(formatClassDate(stored, { weekday: false })).toBe("September 14, 2026");
    expect(formatClassDate(stored, { month: "short", weekday: false })).toBe("Sep 14, 2026");
  });

  test("combined date-time formatting", () => {
    const stored = toFloatingISO("2026-09-14", "09:00");
    expect(formatClassDateTimeLong(stored)).toBe("Monday, September 14, 2026 at 9:00 AM");
    expect(formatClassDateTimeShort(stored)).toBe("Mon, Sep 14, 9:00 AM");
  });

  test("midnight and noon are not confused", () => {
    expect(formatClassTime(toFloatingISO("2026-09-14", "00:00"))).toBe("12:00 AM");
    expect(formatClassTime(toFloatingISO("2026-09-14", "12:00"))).toBe("12:00 PM");
  });

  test("renders the same in winter and summer — no DST shift", () => {
    // A floating time has no offset to shift, so an 09:00 class is 9:00 AM in
    // January and in July alike.
    expect(formatClassTime(toFloatingISO("2026-01-15", "09:00"))).toBe("9:00 AM");
    expect(formatClassTime(toFloatingISO("2026-07-15", "09:00"))).toBe("9:00 AM");
  });
});

describe("floatingNow / msUntilClass", () => {
  test("floatingNow is shaped like a stored class time", () => {
    expect(floatingNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("a class one hour ahead on the business clock reads as future", () => {
    const oneHourOut = addFloatingMinutes(floatingNow(), 60);
    const ms = msUntilClass(oneHourOut);
    expect(ms).toBeGreaterThan(55 * 60 * 1000);
    expect(ms).toBeLessThan(65 * 60 * 1000);
  });

  test("a class one hour past reads as negative", () => {
    const oneHourAgo = addFloatingMinutes(floatingNow(), -60);
    expect(msUntilClass(oneHourAgo)).toBeLessThan(0);
  });

  test("a class 47 hours out fails the 48-hour cancellation gate", () => {
    // The gate that would silently become a ~44-hour gate if it compared a
    // floating class time against a raw UTC now.
    const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
    expect(msUntilClass(addFloatingMinutes(floatingNow(), 47 * 60))).toBeLessThan(
      FORTY_EIGHT_HOURS
    );
    expect(msUntilClass(addFloatingMinutes(floatingNow(), 49 * 60))).toBeGreaterThan(
      FORTY_EIGHT_HOURS
    );
  });
});

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
