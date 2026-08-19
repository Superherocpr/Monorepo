/**
 * Unit tests for lib/payment-failures.ts.
 *
 * Covers the shape of the `payments` row written for a failed attempt (a wrong
 * status or a non-null booking_id here would corrupt the admin payments page
 * and the dashboard revenue figures) and the book_spot error-message mapping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  logPaymentFailure,
  describeBookSpotFailure,
  isLoggableCaptureFailure,
} from "@/lib/payment-failures";

/**
 * Builds a stub Supabase client that captures the row passed to insert().
 * @param error - Optional error for the insert to return.
 */
function stubClient(error: unknown = null) {
  const insert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

describe("logPaymentFailure", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a failed online payment row with no booking attached", async () => {
    const { client, from, insert } = stubClient();

    await logPaymentFailure(
      client,
      {
        customerId: "cust-1",
        amount: 55,
        paypalTransactionId: "CAP-123",
        notes: "Card declined: INSTRUMENT_DECLINED",
      },
      "bookings/confirm"
    );

    expect(from).toHaveBeenCalledWith("payments");
    expect(insert).toHaveBeenCalledWith({
      customer_id: "cust-1",
      booking_id: null,
      amount: 55,
      status: "failed",
      payment_type: "online",
      paypal_transaction_id: "CAP-123",
      notes: "Card declined: INSTRUMENT_DECLINED",
    });
  });

  it("accepts a null transaction id when no capture was ever created", async () => {
    const { client, insert } = stubClient();

    await logPaymentFailure(
      client,
      { customerId: "cust-2", amount: 10, paypalTransactionId: null, notes: "x" },
      "team-signup"
    );

    expect(insert.mock.calls[0][0].paypal_transaction_id).toBeNull();
  });

  it("swallows insert errors so the customer response is unaffected", async () => {
    const { client } = stubClient({ message: "boom" });

    await expect(
      logPaymentFailure(
        client,
        { customerId: "cust-3", amount: 1, paypalTransactionId: null, notes: "x" },
        "bookings/confirm"
      )
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });
});

describe("isLoggableCaptureFailure", () => {
  // THREAT-060: /api/bookings/confirm is unauthenticated, so these codes are
  // what a script posting fabricated order ids would generate. Logging them
  // would let it flood the payments table.
  it.each([
    "RESOURCE_NOT_FOUND",
    "INVALID_RESOURCE_ID",
    "ORDER_NOT_APPROVED",
    "ORDER_ALREADY_CAPTURED",
  ])("skips %s — no real payment was attempted", (issue) => {
    expect(isLoggableCaptureFailure(issue)).toBe(false);
  });

  it.each(["INSTRUMENT_DECLINED", "PAYMENT_DENIED", "CARD_EXPIRED", "TRANSACTION_REFUSED"])(
    "logs %s — a real card was really declined",
    (issue) => {
      expect(isLoggableCaptureFailure(issue)).toBe(true);
    }
  );

  it("logs an unparseable error so server anomalies stay visible", () => {
    expect(isLoggableCaptureFailure(null)).toBe(true);
  });
});

describe("describeBookSpotFailure", () => {
  it.each([
    ["already_booked", "customer already booked into this class"],
    ["session_full", "class filled up during checkout"],
    ["session_unavailable", "class no longer available"],
    ["session_not_found", "session not found"],
  ])("maps %s to a plain-English reason", (code, expected) => {
    expect(describeBookSpotFailure(`error: ${code}`)).toBe(expected);
  });

  it("falls through to the raw message for an unrecognised code", () => {
    expect(describeBookSpotFailure("deadlock detected")).toBe(
      "booking creation failed (deadlock detected)"
    );
  });

  it("omits the parenthetical when there is no message at all", () => {
    expect(describeBookSpotFailure("")).toBe("booking creation failed");
  });
});
