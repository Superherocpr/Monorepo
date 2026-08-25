/**
 * Unit tests for lib/customer-directory.ts.
 *
 * summarizeCustomerActivity backs the Bookings/Certs columns in BOTH
 * /api/customers/search and /api/customers/lookup, so a mistake here reports
 * wrong counts to staff on two separate screens.
 *
 * Pure function — no mocks needed. `now` is injected rather than read from the
 * clock, which is what makes the expiry boundaries testable. In production that
 * reference comes from floatingNow(), since class times are floating wall-clock
 * values (migration 0060); the fixtures here are all relative to NOW, so they
 * hold in either space.
 */
import { describe, test, expect } from "vitest";
import {
  summarizeCustomerActivity,
  type CustomerActivityRow,
} from "@/lib/customer-directory";

const NOW = new Date("2026-06-15T12:00:00Z");

/** Builds a row with only the fields a given case cares about. */
function row(overrides: Partial<CustomerActivityRow> = {}): CustomerActivityRow {
  return { bookings: [], certifications: [], ...overrides };
}

/** ISO timestamp `days` from NOW (negative for the past). */
function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe("summarizeCustomerActivity", () => {
  test("returns zeroes for a customer with no bookings or certifications", () => {
    expect(summarizeCustomerActivity(row(), NOW)).toEqual({
      upcomingBookingsCount: 0,
      totalBookingsCount: 0,
      activeCertsCount: 0,
      hasExpiringSoon: false,
    });
  });

  test("excludes cancelled bookings from both counts", () => {
    const result = summarizeCustomerActivity(
      row({
        bookings: [
          { cancelled: false, class_sessions: { starts_at: daysFromNow(5) } },
          { cancelled: true, class_sessions: { starts_at: daysFromNow(5) } },
        ],
      }),
      NOW
    );

    expect(result.totalBookingsCount).toBe(1);
    expect(result.upcomingBookingsCount).toBe(1);
  });

  test("counts only future sessions as upcoming", () => {
    const result = summarizeCustomerActivity(
      row({
        bookings: [
          { cancelled: false, class_sessions: { starts_at: daysFromNow(-30) } },
          { cancelled: false, class_sessions: { starts_at: daysFromNow(-1) } },
          { cancelled: false, class_sessions: { starts_at: daysFromNow(2) } },
        ],
      }),
      NOW
    );

    expect(result.totalBookingsCount).toBe(3);
    expect(result.upcomingBookingsCount).toBe(1);
  });

  test("handles the embedded session arriving as a one-element array", () => {
    // PostgREST returns an embedded relation as an object or an array depending
    // on cardinality — both shapes reach this function in production.
    const result = summarizeCustomerActivity(
      row({
        bookings: [{ cancelled: false, class_sessions: [{ starts_at: daysFromNow(3) }] }],
      }),
      NOW
    );

    expect(result.upcomingBookingsCount).toBe(1);
  });

  test("treats a booking with no session as not upcoming rather than crashing", () => {
    const result = summarizeCustomerActivity(
      row({ bookings: [{ cancelled: false, class_sessions: null }] }),
      NOW
    );

    expect(result.totalBookingsCount).toBe(1);
    expect(result.upcomingBookingsCount).toBe(0);
  });

  test("counts only unexpired certifications as active", () => {
    const result = summarizeCustomerActivity(
      row({
        certifications: [
          { expires_at: daysFromNow(-1) },
          { expires_at: daysFromNow(200) },
          { expires_at: daysFromNow(400) },
        ],
      }),
      NOW
    );

    expect(result.activeCertsCount).toBe(2);
  });

  test("flags an active certification expiring within 90 days", () => {
    const result = summarizeCustomerActivity(
      row({ certifications: [{ expires_at: daysFromNow(30) }] }),
      NOW
    );

    expect(result.activeCertsCount).toBe(1);
    expect(result.hasExpiringSoon).toBe(true);
  });

  test("does not flag a certification expiring well beyond the 90-day window", () => {
    const result = summarizeCustomerActivity(
      row({ certifications: [{ expires_at: daysFromNow(180) }] }),
      NOW
    );

    expect(result.activeCertsCount).toBe(1);
    expect(result.hasExpiringSoon).toBe(false);
  });

  test("an expired certification never counts as expiring soon", () => {
    const result = summarizeCustomerActivity(
      row({ certifications: [{ expires_at: daysFromNow(-10) }] }),
      NOW
    );

    expect(result.activeCertsCount).toBe(0);
    expect(result.hasExpiringSoon).toBe(false);
  });
});
