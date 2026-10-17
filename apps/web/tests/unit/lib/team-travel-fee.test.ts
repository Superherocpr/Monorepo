/**
 * Unit tests for lib/team-travel-fee.ts
 *
 * Pins the agreed rule for corporate team bookings (2026-10-17): the travel &
 * setup fee applies whenever the COMPANY pays, in either company mode, and is
 * waived when employees pay for their own seat. The default is $65 and staff
 * may change it, including to 0.
 */
import { describe, test, expect } from "vitest";
import {
  TEAM_TRAVEL_FEE_DEFAULT,
  TEAM_TRAVEL_FEE_MAX,
  resolveTeamTravelFee,
  validateTravelFee,
} from "@/lib/team-travel-fee";

describe("TEAM_TRAVEL_FEE_DEFAULT", () => {
  test("is the $65 travel and setup fee", () => {
    expect(TEAM_TRAVEL_FEE_DEFAULT).toBe(65);
  });
});

describe("resolveTeamTravelFee", () => {
  test("defaults to $65 when the company pays and staff entered nothing", () => {
    expect(resolveTeamTravelFee(true, undefined)).toBe(65);
    expect(resolveTeamTravelFee(true, null)).toBe(65);
  });

  test("keeps a staff-entered amount when the company pays", () => {
    expect(resolveTeamTravelFee(true, 90)).toBe(90);
  });

  test("keeps an explicit 0, because a deliberate waiver must not become the default", () => {
    expect(resolveTeamTravelFee(true, 0)).toBe(0);
  });

  test("rounds to cents", () => {
    expect(resolveTeamTravelFee(true, 65.005)).toBe(65.01);
  });

  test("is waived (null) when employees pay, even if a fee was supplied", () => {
    expect(resolveTeamTravelFee(false, undefined)).toBeNull();
    expect(resolveTeamTravelFee(false, 65)).toBeNull();
  });
});

describe("validateTravelFee", () => {
  test("accepts an absent fee, zero, and ordinary amounts", () => {
    expect(validateTravelFee(undefined)).toBeNull();
    expect(validateTravelFee(null)).toBeNull();
    expect(validateTravelFee(0)).toBeNull();
    expect(validateTravelFee(65)).toBeNull();
    expect(validateTravelFee(TEAM_TRAVEL_FEE_MAX)).toBeNull();
  });

  test("rejects a negative fee", () => {
    expect(validateTravelFee(-1)).toMatch(/cannot be negative/i);
  });

  test("rejects a fee above the typo guard", () => {
    expect(validateTravelFee(TEAM_TRAVEL_FEE_MAX + 1)).toMatch(/cannot be more than/i);
  });

  test("rejects non-finite numbers", () => {
    expect(validateTravelFee(Number.NaN)).toMatch(/must be a number/i);
    expect(validateTravelFee(Number.POSITIVE_INFINITY)).toMatch(/must be a number/i);
  });
});
