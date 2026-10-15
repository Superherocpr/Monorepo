/**
 * Unit tests for lib/paypal-invoice-fees.ts.
 *
 * PayPal's invoice response says how an invoice was paid but not what it cost;
 * the fee comes from Transaction Search, as a NEGATIVE amount, and can appear
 * late. These tests pin the three things that make the number trustworthy:
 * only PayPal-processed payments are priced, a missing fee is "pending" rather
 * than zero, and a failed lookup is reported as unavailable rather than hidden.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/paypal", () => ({
  getPayPalAccessToken: vi.fn().mockResolvedValue("token"),
  getPayPalApiBase: () => "https://api.paypal.test",
}));

import {
  parseInvoicePayPalPayments,
  parseTransactionSearchFee,
  lookupInvoicePayPalFee,
} from "@/lib/paypal-invoice-fees";

describe("parseInvoicePayPalPayments", () => {
  test("keeps PayPal-processed payments and their transaction ids", () => {
    const result = parseInvoicePayPalPayments({
      payments: {
        transactions: [
          { type: "PAYPAL", method: "PAYPAL", payment_id: "TXN1" },
          { type: "PAYPAL", method: "CREDIT_CARD", payment_id: "TXN2" },
        ],
      },
    });
    expect(result).toEqual([{ transactionId: "TXN1" }, { transactionId: "TXN2" }]);
  });

  test("ignores external check and cash payments recorded on PayPal", () => {
    // These have no PayPal transaction and no fee; pricing them would invent one.
    const result = parseInvoicePayPalPayments({
      payments: {
        transactions: [
          { type: "EXTERNAL", method: "CHECK", payment_id: "X1" },
          { type: "EXTERNAL", method: "CASH" },
        ],
      },
    });
    expect(result).toEqual([]);
  });

  test("ignores a PayPal payment with no transaction id", () => {
    expect(
      parseInvoicePayPalPayments({ payments: { transactions: [{ type: "PAYPAL", method: "PAYPAL" }] } })
    ).toEqual([]);
  });

  test("returns nothing for malformed input", () => {
    expect(parseInvoicePayPalPayments(null)).toEqual([]);
    expect(parseInvoicePayPalPayments({})).toEqual([]);
    expect(parseInvoicePayPalPayments({ payments: { transactions: "x" } })).toEqual([]);
  });
});

describe("parseTransactionSearchFee", () => {
  const row = (id: string, fee?: string) => ({
    transaction_info: { transaction_id: id, ...(fee ? { fee_amount: { value: fee } } : {}) },
  });

  test("returns the fee as a positive number", () => {
    expect(parseTransactionSearchFee({ transaction_details: [row("T1", "-49.60")] }, "T1")).toBe(49.6);
  });

  test("returns null when PayPal reports no fee yet, never zero", () => {
    expect(parseTransactionSearchFee({ transaction_details: [row("T1")] }, "T1")).toBeNull();
  });

  test("does not double count the duplicate rows PayPal can list for one id", () => {
    const body = { transaction_details: [row("T1", "-3.20"), row("T1", "-3.20")] };
    expect(parseTransactionSearchFee(body, "T1")).toBe(3.2);
  });

  test("ignores rows belonging to a different transaction", () => {
    expect(parseTransactionSearchFee({ transaction_details: [row("T2", "-9.99")] }, "T1")).toBeNull();
  });

  test("returns null for malformed input", () => {
    expect(parseTransactionSearchFee(null, "T1")).toBeNull();
    expect(parseTransactionSearchFee({}, "T1")).toBeNull();
  });
});

describe("lookupInvoicePayPalFee", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  const paidInvoice = {
    payments: { transactions: [{ type: "PAYPAL", method: "PAYPAL", payment_id: "TXN1" }] },
  };

  test("returns the fee when PayPal reports it", async () => {
    fetchMock
      .mockResolvedValueOnce(json(paidInvoice))
      .mockResolvedValueOnce(
        json({ transaction_details: [{ transaction_info: { transaction_id: "TXN1", fee_amount: { value: "-49.60" } } }] })
      );

    const result = await lookupInvoicePayPalFee("INV2-X", new Date("2026-10-13T12:00:00Z"));
    expect(result).toEqual({ status: "found", fee: 49.6 });

    // Transaction Search allows at most 31 days; the window must stay inside that.
    const searchUrl = new URL(fetchMock.mock.calls[1][0] as string);
    const days =
      (Date.parse(searchUrl.searchParams.get("end_date") as string) -
        Date.parse(searchUrl.searchParams.get("start_date") as string)) /
      86_400_000;
    expect(days).toBeLessThanOrEqual(31);
    expect(searchUrl.searchParams.get("transaction_id")).toBe("TXN1");
  });

  test("is pending when the invoice shows no PayPal payment yet", async () => {
    fetchMock.mockResolvedValueOnce(json({ payments: { transactions: [] } }));
    expect(await lookupInvoicePayPalFee("INV2-X", new Date())).toEqual({ status: "pending" });
  });

  test("is pending, not zero, when Transaction Search has no fee yet", async () => {
    fetchMock
      .mockResolvedValueOnce(json(paidInvoice))
      .mockResolvedValueOnce(json({ transaction_details: [] }));
    expect(await lookupInvoicePayPalFee("INV2-X", new Date())).toEqual({ status: "pending" });
  });

  test("reports unavailable when Transaction Search is not permitted", async () => {
    fetchMock
      .mockResolvedValueOnce(json(paidInvoice))
      .mockResolvedValueOnce(json({ name: "NOT_AUTHORIZED" }, 403));
    const result = await lookupInvoicePayPalFee("INV2-X", new Date());
    expect(result).toEqual({ status: "unavailable", reason: "Transaction Search returned 403" });
  });

  test("reports unavailable when the invoice lookup fails", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    const result = await lookupInvoicePayPalFee("INV2-X", new Date());
    expect(result.status).toBe("unavailable");
  });

  test("sums the fee across several PayPal payments on one invoice", async () => {
    const twoPayments = {
      payments: {
        transactions: [
          { type: "PAYPAL", method: "PAYPAL", payment_id: "TXN1" },
          { type: "PAYPAL", method: "PAYPAL", payment_id: "TXN2" },
        ],
      },
    };
    const feeFor = (id: string, value: string) =>
      json({ transaction_details: [{ transaction_info: { transaction_id: id, fee_amount: { value } } }] });
    fetchMock
      .mockResolvedValueOnce(json(twoPayments))
      .mockResolvedValueOnce(feeFor("TXN1", "-10.00"))
      .mockResolvedValueOnce(feeFor("TXN2", "-5.50"));
    expect(await lookupInvoicePayPalFee("INV2-X", new Date())).toEqual({ status: "found", fee: 15.5 });
  });
});
