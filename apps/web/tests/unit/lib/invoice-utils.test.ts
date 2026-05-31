/**
 * Unit tests for lib/invoice-utils.ts
 *
 * Covers: formatCurrency, formatDate, formatDateTime, STATUS_BADGES, PLATFORM_LABELS.
 * All functions are pure with no I/O.
 */
import { describe, test, expect } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  STATUS_BADGES,
  PLATFORM_LABELS,
} from "@/lib/invoice-utils";

describe("formatCurrency", () => {
  test("formats a whole dollar amount with two decimal places", () => {
    expect(formatCurrency(100)).toBe("$100.00");
  });

  test("formats a large amount with comma separator", () => {
    expect(formatCurrency(1500)).toBe("$1,500.00");
  });

  test("formats a fractional amount", () => {
    expect(formatCurrency(49.99)).toBe("$49.99");
  });

  test("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  test("formats a sub-dollar amount", () => {
    expect(formatCurrency(0.5)).toBe("$0.50");
  });

  test("formats a very large amount", () => {
    expect(formatCurrency(100000)).toBe("$100,000.00");
  });
});

describe("formatDate", () => {
  // Use noon UTC so the date doesn't cross a day boundary in any timezone
  test("formats an ISO date string as short month + day + year", () => {
    const result = formatDate("2026-05-15T12:00:00Z");
    expect(result).toContain("May");
    expect(result).toContain("15");
    expect(result).toContain("2026");
  });

  test("formats a January date correctly", () => {
    const result = formatDate("2026-01-01T12:00:00Z");
    expect(result).toContain("Jan");
    expect(result).toContain("1");
    expect(result).toContain("2026");
  });
});

describe("formatDateTime", () => {
  test("returns a string containing the date and a time component", () => {
    // The exact output depends on timezone, so we just verify structure
    const result = formatDateTime("2026-05-15T12:00:00Z");
    expect(result).toContain("2026");
    // Should include AM or PM
    expect(result).toMatch(/AM|PM/);
  });

  test("includes both date and time components in the output", () => {
    // The separator between date and time is locale/runtime-specific (comma in Node.js,
    // 'at' in some browsers). Just verify both a year and a time indicator are present.
    const result = formatDateTime("2026-05-15T12:00:00Z");
    expect(result).toContain("2026");
    expect(result).toMatch(/AM|PM/);
  });
});

describe("STATUS_BADGES", () => {
  test("all three statuses have label and classes defined", () => {
    expect(STATUS_BADGES.sent.label).toBe("Sent");
    expect(STATUS_BADGES.paid.label).toBe("Paid");
    expect(STATUS_BADGES.cancelled.label).toBe("Cancelled");
  });

  test("paid status uses green badge classes", () => {
    expect(STATUS_BADGES.paid.classes).toContain("green");
  });

  test("sent status uses blue badge classes", () => {
    expect(STATUS_BADGES.sent.classes).toContain("blue");
  });

  test("cancelled status uses gray badge classes", () => {
    expect(STATUS_BADGES.cancelled.classes).toContain("gray");
  });
});

describe("PLATFORM_LABELS", () => {
  test("paypal maps to 'PayPal'", () => {
    expect(PLATFORM_LABELS.paypal).toBe("PayPal");
  });

  test("square maps to 'Square'", () => {
    expect(PLATFORM_LABELS.square).toBe("Square");
  });

  test("venmo_business maps to 'Venmo Business'", () => {
    expect(PLATFORM_LABELS.venmo_business).toBe("Venmo Business");
  });

  test("stripe maps to 'Stripe'", () => {
    expect(PLATFORM_LABELS.stripe).toBe("Stripe");
  });
});
