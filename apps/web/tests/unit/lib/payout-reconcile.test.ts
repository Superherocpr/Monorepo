/**
 * Unit tests for the pure status-mapping functions in lib/payout-reconcile.ts
 * plus parseCaptureFees from lib/paypal.ts.
 *
 * Covers: mapPayPalItemStatus, releasesEarnings, isInFlight, parseCaptureFees.
 *
 * These decide whether money is treated as returned or still committed, which is
 * the difference between re-paying an instructor correctly and paying them twice.
 */
import { describe, test, expect } from "vitest";
import {
  isInFlight,
  mapPayPalItemStatus,
  releasesEarnings,
} from "@/lib/payout-reconcile";
import { parseCaptureFees } from "@/lib/paypal";

describe("mapPayPalItemStatus", () => {
  test("SUCCESS means delivered", () => {
    expect(mapPayPalItemStatus("SUCCESS")).toBe("completed");
  });

  test("UNCLAIMED gets its own status rather than being treated as returned", () => {
    // PayPal still holds this money for 30 days, so releasing the earnings would
    // let the same amount go out twice.
    expect(mapPayPalItemStatus("UNCLAIMED")).toBe("unclaimed");
  });

  test.each(["DENIED", "BLOCKED", "RETURNED", "REFUNDED", "REVERSED", "CANCELED"])(
    "%s means the funds came back",
    (status) => {
      expect(mapPayPalItemStatus(status)).toBe("denied");
    }
  );

  test("FAILED means it never sent", () => {
    expect(mapPayPalItemStatus("FAILED")).toBe("failed");
  });

  test.each(["PENDING", "PROCESSING", "ONHOLD", "HELD"])(
    "%s is still in flight",
    (status) => {
      expect(mapPayPalItemStatus(status)).toBe("assumed_complete");
    }
  );

  test("is case insensitive", () => {
    expect(mapPayPalItemStatus("success")).toBe("completed");
    expect(mapPayPalItemStatus("denied")).toBe("denied");
  });

  test("treats an unrecognised status as still in flight", () => {
    // Withholding the earnings is the safe default for a status we do not know.
    expect(mapPayPalItemStatus("SOME_NEW_PAYPAL_STATUS")).toBe("assumed_complete");
  });
});

describe("releasesEarnings", () => {
  test("denied and failed put earnings back in the queue", () => {
    expect(releasesEarnings("denied")).toBe(true);
    expect(releasesEarnings("failed")).toBe(true);
  });

  test("completed does not release earnings", () => {
    expect(releasesEarnings("completed")).toBe(false);
  });

  test("unclaimed does not release earnings", () => {
    expect(releasesEarnings("unclaimed")).toBe(false);
  });

  test("assumed_complete does not release earnings", () => {
    expect(releasesEarnings("assumed_complete")).toBe(false);
  });

  test("needs_review does not release earnings", () => {
    // The outcome is unknown; releasing here is exactly the double-pay risk.
    expect(releasesEarnings("needs_review")).toBe(false);
  });
});

describe("isInFlight", () => {
  test("assumed_complete, unclaimed, and pending are in flight", () => {
    expect(isInFlight("assumed_complete")).toBe(true);
    expect(isInFlight("unclaimed")).toBe(true);
    expect(isInFlight("pending")).toBe(true);
  });

  test("terminal statuses are not in flight", () => {
    expect(isInFlight("completed")).toBe(false);
    expect(isInFlight("denied")).toBe(false);
    expect(isInFlight("failed")).toBe(false);
  });
});

describe("parseCaptureFees", () => {
  test("reads gross, fee, and net from a PayPal breakdown", () => {
    const fees = parseCaptureFees({
      gross_amount: { currency_code: "USD", value: "100.00" },
      paypal_fee: { currency_code: "USD", value: "3.20" },
      net_amount: { currency_code: "USD", value: "96.80" },
    });
    expect(fees.grossAmount).toBe(100);
    expect(fees.paypalFee).toBe(3.2);
    expect(fees.netAmount).toBe(96.8);
  });

  test("returns nulls when the breakdown is missing", () => {
    // Null means "not tracked", never zero — a zero fee would misreport margin.
    const fees = parseCaptureFees(undefined);
    expect(fees.grossAmount).toBeNull();
    expect(fees.paypalFee).toBeNull();
    expect(fees.netAmount).toBeNull();
  });

  test("returns nulls for a null breakdown", () => {
    const fees = parseCaptureFees(null);
    expect(fees.paypalFee).toBeNull();
  });

  test("returns null for individually missing fields", () => {
    const fees = parseCaptureFees({ paypal_fee: { value: "1.50" } });
    expect(fees.paypalFee).toBe(1.5);
    expect(fees.grossAmount).toBeNull();
    expect(fees.netAmount).toBeNull();
  });

  test("returns null for an unparseable value", () => {
    const fees = parseCaptureFees({ paypal_fee: { value: "not-a-number" } });
    expect(fees.paypalFee).toBeNull();
  });

  test("returns null when the value is not a string", () => {
    const fees = parseCaptureFees({ paypal_fee: { value: 3.2 } });
    expect(fees.paypalFee).toBeNull();
  });
});
