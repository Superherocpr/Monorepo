/**
 * Unit tests for lib/mock-payments.ts.
 *
 * isMockPaymentsEnabled() is the single gate every charge-and-book,
 * capture-manual-charge, create-manual-charge-order, and mock-status call
 * defers to before treating a request as mocked. The property under test is
 * that ALL THREE guard conditions are independently required — no single
 * misconfigured env var, on its own, can turn on a bypass that fabricates a
 * settled charge.
 */
import { describe, test, expect, afterEach } from "vitest";
import {
  isMockPaymentsEnabled,
  createMockOrderId,
  mockCaptureOutcome,
  MOCK_ID_PREFIX,
} from "@/lib/mock-payments";

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** A staging-shaped env: flag on, neither production literal present. */
const STAGING_ENV = {
  MOCK_PAYMENTS: "true",
  NEXT_PUBLIC_BASE_URL: "https://staging.dzmna7ztg21it.amplifyapp.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://zhymgbftdoastnapwrob.supabase.co",
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("isMockPaymentsEnabled", () => {
  test("is false when MOCK_PAYMENTS is unset — the production default", () => {
    setEnv({ ...STAGING_ENV, MOCK_PAYMENTS: undefined });
    expect(isMockPaymentsEnabled()).toBe(false);
  });

  test("is false when MOCK_PAYMENTS is any value other than the literal string 'true'", () => {
    setEnv({ ...STAGING_ENV, MOCK_PAYMENTS: "1" });
    expect(isMockPaymentsEnabled()).toBe(false);
  });

  test("is true on a correctly configured staging-shaped environment", () => {
    setEnv(STAGING_ENV);
    expect(isMockPaymentsEnabled()).toBe(true);
  });

  test("is false when NEXT_PUBLIC_BASE_URL is the production domain, even with the flag set", () => {
    setEnv({ ...STAGING_ENV, NEXT_PUBLIC_BASE_URL: "https://superherocpr.com" });
    expect(isMockPaymentsEnabled()).toBe(false);
  });

  test("is false when NEXT_PUBLIC_SUPABASE_URL is the production project, even with the flag set", () => {
    setEnv({ ...STAGING_ENV, NEXT_PUBLIC_SUPABASE_URL: "https://qgvlguifubbnclxfascz.supabase.co" });
    expect(isMockPaymentsEnabled()).toBe(false);
  });

  test("is false when BOTH production literals are present alongside the flag", () => {
    // The scenario an app-level env var mistake would actually produce: the
    // flag leaks everywhere, but so would every other value already do today.
    setEnv({
      MOCK_PAYMENTS: "true",
      NEXT_PUBLIC_BASE_URL: "https://superherocpr.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://qgvlguifubbnclxfascz.supabase.co",
    });
    expect(isMockPaymentsEnabled()).toBe(false);
  });
});

describe("createMockOrderId", () => {
  test("is prefixed with MOCK_ID_PREFIX", () => {
    expect(createMockOrderId().startsWith(MOCK_ID_PREFIX)).toBe(true);
  });

  test("is unique per call", () => {
    expect(createMockOrderId()).not.toBe(createMockOrderId());
  });
});

describe("mockCaptureOutcome", () => {
  test("reports settled with the requested amount as capturedAmount", () => {
    const outcome = mockCaptureOutcome(75);
    expect(outcome.settled).toBe(true);
    if (outcome.settled) {
      expect(outcome.capturedAmount).toBe(75);
      expect(outcome.captureId?.startsWith(MOCK_ID_PREFIX)).toBe(true);
    }
  });

  test("leaves fee fields null rather than fabricating a zero fee", () => {
    const outcome = mockCaptureOutcome(40);
    if (outcome.settled) {
      expect(outcome.fees).toEqual({ grossAmount: null, paypalFee: null, netAmount: null });
    }
  });
});
