/**
 * Unit tests for evaluateCaptureOutcome (lib/paypal.ts).
 *
 * Regression coverage for THREAT-054: a declined card returns HTTP 201 with a
 * populated seller_receivable_breakdown and an amount matching the order, which
 * previously passed the old `response.ok` + amount-only checks and produced a
 * confirmed booking, phantom revenue, and an instructor payout liability.
 *
 * The DECLINED fixture below is the real payload shape returned by PayPal for
 * the live declined transaction 99434303YL747080U.
 */

import { describe, it, expect } from "vitest";
import { evaluateCaptureOutcome, classifyCaptureRequestError } from "@/lib/paypal";

/** Builds a capture response body with the given capture fields. */
function captureResponse(capture: Record<string, unknown>) {
  return { purchase_units: [{ payments: { captures: [capture] } }] };
}

/** Fee block PayPal returns — present on declined captures too, not just settled ones. */
const SELLER_BREAKDOWN = {
  gross_amount: { currency_code: "USD", value: "55.00" },
  paypal_fee: { currency_code: "USD", value: "1.88" },
  net_amount: { currency_code: "USD", value: "53.12" },
};

describe("evaluateCaptureOutcome", () => {
  it("treats a COMPLETED capture as settled and returns amount + fees", () => {
    const outcome = evaluateCaptureOutcome(
      captureResponse({
        id: "3C679366HH908993F",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "55.00" },
        seller_receivable_breakdown: SELLER_BREAKDOWN,
      })
    );

    expect(outcome.settled).toBe(true);
    if (!outcome.settled) return;
    expect(outcome.captureId).toBe("3C679366HH908993F");
    expect(outcome.capturedAmount).toBe(55);
    expect(outcome.fees.paypalFee).toBe(1.88);
    expect(outcome.fees.netAmount).toBe(53.12);
  });

  it("treats a DECLINED capture as unsettled even though it carries a full fee breakdown", () => {
    // This is the exact shape that caused THREAT-054 — note the realistic
    // amount and fee block on a payment that never actually took funds.
    const outcome = evaluateCaptureOutcome(
      captureResponse({
        id: "99434303YL747080U",
        status: "DECLINED",
        amount: { currency_code: "USD", value: "55.00" },
        seller_receivable_breakdown: SELLER_BREAKDOWN,
        processor_response: { response_code: "9100", payment_advice_code: "02" },
      })
    );

    expect(outcome.settled).toBe(false);
    if (outcome.settled) return;
    expect(outcome.status).toBe("DECLINED");
    expect(outcome.captureId).toBe("99434303YL747080U");
    expect(outcome.processorResponseCode).toBe("9100");
  });

  it.each(["PENDING", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"])(
    "treats a %s capture as unsettled",
    (status) => {
      const outcome = evaluateCaptureOutcome(
        captureResponse({
          id: "CAPTURE-ID",
          status,
          amount: { currency_code: "USD", value: "55.00" },
          seller_receivable_breakdown: SELLER_BREAKDOWN,
        })
      );

      expect(outcome.settled).toBe(false);
      if (outcome.settled) return;
      expect(outcome.status).toBe(status);
    }
  );

  it("treats a capture with no status field as unsettled rather than assuming success", () => {
    const outcome = evaluateCaptureOutcome(
      captureResponse({ id: "CAPTURE-ID", amount: { value: "55.00" } })
    );

    expect(outcome.settled).toBe(false);
    if (outcome.settled) return;
    expect(outcome.status).toBeNull();
  });

  it("treats a response with no capture object as unsettled", () => {
    expect(evaluateCaptureOutcome({ purchase_units: [{ payments: {} }] }).settled).toBe(false);
    expect(evaluateCaptureOutcome({}).settled).toBe(false);
    expect(evaluateCaptureOutcome(null).settled).toBe(false);
    expect(evaluateCaptureOutcome(undefined).settled).toBe(false);
  });

  it("returns a null capturedAmount when the amount is missing or unparseable", () => {
    const outcome = evaluateCaptureOutcome(
      captureResponse({ id: "CAPTURE-ID", status: "COMPLETED" })
    );

    expect(outcome.settled).toBe(true);
    if (!outcome.settled) return;
    expect(outcome.capturedAmount).toBeNull();
  });
});

describe("classifyCaptureRequestError", () => {
  // Real payload pulled from CloudWatch for the live production capture
  // failure debug_id b95be1046efcf (2026-08-04) — a declined card is rejected
  // by PayPal at the HTTP level (422), not only as a 2xx capture with status
  // DECLINED. Every capture route previously folded this into a generic
  // "Payment capture failed. Please refresh and try again." — wrong advice
  // for a decline.
  const PAYMENT_DENIED_BODY = JSON.stringify({
    name: "UNPROCESSABLE_ENTITY",
    details: [
      {
        issue: "PAYMENT_DENIED",
        description: "PayPal has declined to process this transaction.",
      },
    ],
    message: "The requested action could not be performed, semantically incorrect, or failed business validation.",
    debug_id: "b95be1046efcf",
  });

  it("classifies PAYMENT_DENIED as a decline", () => {
    const result = classifyCaptureRequestError(PAYMENT_DENIED_BODY);
    expect(result.declined).toBe(true);
    expect(result.issue).toBe("PAYMENT_DENIED");
  });

  it.each(["INSTRUMENT_DECLINED", "CARD_EXPIRED", "TRANSACTION_REFUSED"])(
    "classifies %s as a decline",
    (issue) => {
      const body = JSON.stringify({ name: "UNPROCESSABLE_ENTITY", details: [{ issue }] });
      const result = classifyCaptureRequestError(body);
      expect(result.declined).toBe(true);
      expect(result.issue).toBe(issue);
    }
  );

  it("does not classify a non-decline integration error as a decline", () => {
    // ORDER_ALREADY_CAPTURED is our bug, not the buyer's card — must not tell
    // them to "try a different card".
    const body = JSON.stringify({
      name: "UNPROCESSABLE_ENTITY",
      details: [{ issue: "ORDER_ALREADY_CAPTURED" }],
    });
    const result = classifyCaptureRequestError(body);
    expect(result.declined).toBe(false);
    expect(result.issue).toBe("ORDER_ALREADY_CAPTURED");
  });

  it("does not classify unparseable or empty text as a decline", () => {
    expect(classifyCaptureRequestError("").declined).toBe(false);
    expect(classifyCaptureRequestError("not json").declined).toBe(false);
    expect(classifyCaptureRequestError("{}").declined).toBe(false);
  });
});
