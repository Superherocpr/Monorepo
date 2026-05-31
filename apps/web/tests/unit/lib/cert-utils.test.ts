/**
 * Unit tests for lib/cert-utils.ts
 *
 * Covers: formatCertificationDate, getCertificationDaysUntilExpiry,
 * isCertificationActive, isCertificationExpiringSoon, getCertStatus, getCertConfig.
 * All functions are pure (no I/O) and use an injectable `now` parameter so tests
 * are deterministic regardless of when they run.
 */
import { describe, test, expect } from "vitest";
import {
  formatCertificationDate,
  getCertificationDaysUntilExpiry,
  isCertificationActive,
  isCertificationExpiringSoon,
  getCertStatus,
  getCertConfig,
  CERT_CONFIGS,
} from "@/lib/cert-utils";

// Fixed reference point: May 31, 2026 noon local time
const NOW = new Date(2026, 4, 31, 12, 0, 0);

describe("formatCertificationDate", () => {
  test("formats a date-only string as a long local date", () => {
    // Date-only strings must be parsed as local (not UTC) to avoid timezone shifts
    expect(formatCertificationDate("2026-05-15")).toMatch(/May 15, 2026/);
  });

  test("formats a timestamp string using the date portion", () => {
    expect(formatCertificationDate("2026-01-01T00:00:00")).toMatch(/January 1, 2026/);
  });

  test("handles leap-day dates correctly", () => {
    expect(formatCertificationDate("2024-02-29")).toMatch(/February 29, 2024/);
  });
});

describe("getCertificationDaysUntilExpiry", () => {
  test("returns a positive number for a future expiry date", () => {
    const days = getCertificationDaysUntilExpiry("2026-06-30", NOW);
    expect(days).toBeGreaterThan(0);
  });

  test("returns a negative number for a past expiry date", () => {
    const days = getCertificationDaysUntilExpiry("2026-05-01", NOW);
    expect(days).toBeLessThan(0);
  });

  test("returns 0 or 1 for an expiry date matching today", () => {
    // The expiry cutoff for a date-only value is set to 23:59:59.999 that day.
    // Since NOW is noon, the same-day cert still has time remaining.
    const days = getCertificationDaysUntilExpiry("2026-05-31", NOW);
    expect(days).toBeGreaterThanOrEqual(0);
    expect(days).toBeLessThanOrEqual(1);
  });

  test("returns 2 for an expiry on the next calendar day given a noon reference", () => {
    // June 1 date-only cutoff = June 1 23:59:59.999
    // NOW is May 31 noon → 35h 59m 59.999s of time remaining → ceil(1.4999) = 2
    expect(getCertificationDaysUntilExpiry("2026-06-01", NOW)).toBe(2);
  });
});

describe("isCertificationActive", () => {
  test("returns true for a cert that expires in the future", () => {
    expect(isCertificationActive("2027-01-01", NOW)).toBe(true);
  });

  test("returns false for a cert that expired yesterday", () => {
    expect(isCertificationActive("2026-05-30", NOW)).toBe(false);
  });

  test("returns true for a cert expiring today (date-only expiry is valid until end of day)", () => {
    // Expiry is treated as 23:59:59.999 on that day; noon is before that.
    expect(isCertificationActive("2026-05-31", NOW)).toBe(true);
  });

  test("returns false for a timestamp expiry that has already passed", () => {
    expect(isCertificationActive("2026-05-31T09:00:00", NOW)).toBe(false);
  });
});

describe("isCertificationExpiringSoon", () => {
  test("returns true when expiry is within the default 90-day window", () => {
    expect(isCertificationExpiringSoon("2026-07-01", NOW)).toBe(true);
  });

  test("returns false when expiry is beyond 90 days", () => {
    expect(isCertificationExpiringSoon("2027-12-31", NOW)).toBe(false);
  });

  test("returns false for an already-expired cert", () => {
    expect(isCertificationExpiringSoon("2026-01-01", NOW)).toBe(false);
  });

  test("respects a custom withinDays threshold", () => {
    // 30 days from now → expiring soon at 45-day threshold, not at 20-day threshold
    expect(isCertificationExpiringSoon("2026-06-30", NOW, 45)).toBe(true);
    expect(isCertificationExpiringSoon("2026-06-30", NOW, 20)).toBe(false);
  });
});

describe("getCertStatus", () => {
  test("returns green and an expiry date label for a cert valid beyond 90 days", () => {
    const status = getCertStatus("2028-01-01");
    expect(status.color).toBe("green");
    // Label is "Expires {formatted date}" — not a static string
    expect(status.label).toMatch(/^Expires/);
    expect(status.label).toContain("2028");
  });

  test("returns amber and a days-remaining label for a cert expiring within 90 days", () => {
    // Use a date 30 days from today — cannot inject now into getCertStatus but the
    // assertion is structural (color + format), not tied to an exact count
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const status = getCertStatus(soon.toISOString().slice(0, 10));
    expect(status.color).toBe("amber");
    // Label is "Expires in X day(s)" — not a static string
    expect(status.label).toMatch(/^Expires in \d+ days?$/);
  });

  test("returns red/Expired for a cert with a past expiry date", () => {
    const status = getCertStatus("2020-01-01");
    expect(status.color).toBe("red");
    expect(status.label).toBe("Expired");
  });
});

describe("CERT_CONFIGS", () => {
  test("all entries have required fields", () => {
    for (const [name, config] of Object.entries(CERT_CONFIGS)) {
      expect(config, `${name} missing category`).toHaveProperty("category");
      expect(config, `${name} missing color`).toHaveProperty("color");
      expect(config, `${name} missing nameLine1`).toHaveProperty("nameLine1");
      expect(config, `${name} missing nameLine2`).toHaveProperty("nameLine2");
    }
  });

  test("BLS Provider eCard maps to the blue BLS color", () => {
    expect(CERT_CONFIGS["BLS Provider eCard"].color).toBe("#4086CA");
    expect(CERT_CONFIGS["BLS Provider eCard"].category).toBe("BLS");
  });

  test("ACLS certs map to the red ACLS color", () => {
    expect(CERT_CONFIGS["ACLS Provider eCard"].color).toBe("#D12F36");
  });
});

describe("getCertConfig", () => {
  test("returns the correct config for a known cert name", () => {
    const config = getCertConfig("BLS Provider eCard");
    expect(config.category).toBe("BLS");
    expect(config.nameLine1).toBe("BLS");
    expect(config.nameLine2).toBe("Provider");
    // displayName should strip ' eCard' suffix
    expect(config.displayName).toBe("BLS Provider");
  });

  test("returns a fallback for an unknown cert name", () => {
    const config = getCertConfig("Unknown Cert eCard");
    expect(config.category).toBe("CERTIFICATION");
    expect(config.color).toBe("#1A1919");
    expect(config.nameLine1).toBe("Unknown Cert");
  });

  test("strips the eCard suffix for displayName on known certs", () => {
    const config = getCertConfig("Heartsaver® CPR AED eCard");
    expect(config.displayName).not.toContain("eCard");
  });
});
