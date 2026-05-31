/**
 * Unit tests for lib/instructor-earnings.ts
 *
 * Only covers calculateInstructorEarning — the pure math function.
 * Database-dependent helpers (getPlatformFeePercent, recordBookingEarning, etc.)
 * are integration concerns and covered by E2E tests instead.
 */
import { describe, test, expect } from "vitest";
import { calculateInstructorEarning } from "@/lib/instructor-earnings";

describe("calculateInstructorEarning", () => {
  test("calculates a standard 20% platform fee correctly", () => {
    const result = calculateInstructorEarning(100, 20);
    expect(result.grossAmount).toBe(100);
    expect(result.platformFeePercent).toBe(20);
    expect(result.platformFeeAmount).toBe(20);
    expect(result.instructorAmount).toBe(80);
  });

  test("rounds to two decimal places (cents math)", () => {
    // $55 × 20% = $11 even — no rounding needed here
    const result = calculateInstructorEarning(55, 20);
    expect(result.platformFeeAmount).toBe(11);
    expect(result.instructorAmount).toBe(44);
  });

  test("handles a fractional result correctly", () => {
    // $33 × 20% = $6.60
    const result = calculateInstructorEarning(33, 20);
    expect(result.platformFeeAmount).toBe(6.6);
    expect(result.instructorAmount).toBe(26.4);
  });

  test("returns all-to-instructor when fee is 0%", () => {
    const result = calculateInstructorEarning(75, 0);
    expect(result.platformFeeAmount).toBe(0);
    expect(result.instructorAmount).toBe(75);
  });

  test("returns all-to-platform when fee is 100%", () => {
    const result = calculateInstructorEarning(100, 100);
    expect(result.platformFeeAmount).toBe(100);
    expect(result.instructorAmount).toBe(0);
  });

  test("clamps a fee percentage above 100 to 100", () => {
    const result = calculateInstructorEarning(100, 150);
    expect(result.platformFeePercent).toBe(100);
    expect(result.instructorAmount).toBe(0);
  });

  test("clamps a negative fee percentage to 0", () => {
    const result = calculateInstructorEarning(100, -10);
    expect(result.platformFeePercent).toBe(0);
    expect(result.instructorAmount).toBe(100);
  });

  test("clamps a negative gross amount to 0", () => {
    const result = calculateInstructorEarning(-50, 20);
    expect(result.grossAmount).toBe(0);
    expect(result.platformFeeAmount).toBe(0);
    expect(result.instructorAmount).toBe(0);
  });

  test("instructor amount + platform fee equals gross amount", () => {
    // This invariant must hold for any input to prevent money disappearing
    for (const [gross, fee] of [
      [0, 0],
      [100, 20],
      [55, 15],
      [1000, 33],
      [0.01, 50],
    ] as [number, number][]) {
      const result = calculateInstructorEarning(gross, fee);
      expect(
        result.instructorAmount + result.platformFeeAmount,
        `gross=${gross} fee=${fee}`
      ).toBeCloseTo(result.grossAmount, 10);
    }
  });
});
