/**
 * Unit tests for lib/contact-constants.ts
 *
 * Verifies that the canonical inquiry type list is present, stable, and
 * contains the values that the contact form, admin filter, and API route all rely on.
 */
import { describe, test, expect } from "vitest";
import { CONTACT_INQUIRY_TYPES } from "@/lib/contact-constants";

describe("CONTACT_INQUIRY_TYPES", () => {
  test("is a non-empty array", () => {
    expect(Array.isArray(CONTACT_INQUIRY_TYPES)).toBe(true);
    expect(CONTACT_INQUIRY_TYPES.length).toBeGreaterThan(0);
  });

  test("contains expected canonical inquiry types", () => {
    expect(CONTACT_INQUIRY_TYPES).toContain("General Question");
    expect(CONTACT_INQUIRY_TYPES).toContain("Group Booking (5+ people)");
    expect(CONTACT_INQUIRY_TYPES).toContain("Corporate / Workplace Training");
    expect(CONTACT_INQUIRY_TYPES).toContain("Certification Renewal");
    expect(CONTACT_INQUIRY_TYPES).toContain("Booking Inquiry");
    expect(CONTACT_INQUIRY_TYPES).toContain("Other");
  });

  test("all entries are non-empty strings", () => {
    for (const type of CONTACT_INQUIRY_TYPES) {
      expect(typeof type).toBe("string");
      expect(type.trim().length).toBeGreaterThan(0);
    }
  });

  test("has no duplicate values", () => {
    const unique = new Set(CONTACT_INQUIRY_TYPES);
    expect(unique.size).toBe(CONTACT_INQUIRY_TYPES.length);
  });
});
