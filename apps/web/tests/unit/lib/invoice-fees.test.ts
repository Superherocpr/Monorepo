/**
 * Unit tests for lib/invoice-fees.ts.
 *
 * The rule under test: only PayPal costs a collection fee. A check, cash or bank
 * transfer is a KNOWN zero (so it stops being flagged as "no fee recorded"), and
 * a PayPal payment stays UNKNOWN (null) until PayPal reports the fee, so the
 * dashboard can tell measured money from guessed money.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const lookupMock = vi.fn();
vi.mock("@/lib/paypal-invoice-fees", () => ({
  lookupInvoicePayPalFee: (...args: unknown[]) => lookupMock(...args),
}));

import {
  isInvoicePaymentMethod,
  resolveInvoiceFees,
  recordInvoicePayment,
  syncInvoicePayPalFees,
} from "@/lib/invoice-fees";

/** Admin client double that records invoice updates and serves a fixed select result. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockClient(rows: unknown[] = []): { client: any; updates: Array<Record<string, unknown>> } {
  const updates: Array<Record<string, unknown>> = [];
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.is = vi.fn(self);
  chain.not = vi.fn(self);
  chain.gte = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  chain.update = vi.fn((values: Record<string, unknown>) => {
    updates.push(values);
    return chain;
  });
  // recordInvoicePayment awaits the chain after .eq(); give it a thenable.
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
  return { client: { from: vi.fn(() => chain) }, updates };
}

beforeEach(() => {
  lookupMock.mockReset();
});

describe("isInvoicePaymentMethod", () => {
  test("accepts the five known methods and nothing else", () => {
    for (const method of ["paypal", "check", "cash", "bank_transfer", "other"]) {
      expect(isInvoicePaymentMethod(method)).toBe(true);
    }
    expect(isInvoicePaymentMethod("venmo")).toBe(false);
    expect(isInvoicePaymentMethod("")).toBe(false);
    expect(isInvoicePaymentMethod(undefined)).toBe(false);
    expect(isInvoicePaymentMethod(5)).toBe(false);
  });
});

describe("resolveInvoiceFees", () => {
  test.each(["check", "cash", "bank_transfer", "other"] as const)(
    "%s is a known zero fee with the full amount deposited",
    (method) => {
      expect(resolveInvoiceFees(method, 1700, null)).toEqual({
        paypalFeeAmount: 0,
        netAmount: 1700,
      });
    }
  );

  test("a non-PayPal method ignores any fee passed in", () => {
    expect(resolveInvoiceFees("check", 100, 3.2)).toEqual({ paypalFeeAmount: 0, netAmount: 100 });
  });

  test("a PayPal payment with no fee yet stays unknown, not zero", () => {
    expect(resolveInvoiceFees("paypal", 1700, null)).toEqual({
      paypalFeeAmount: null,
      netAmount: null,
    });
  });

  test("a PayPal payment with a fee nets the total minus the fee", () => {
    expect(resolveInvoiceFees("paypal", 1700, 49.6)).toEqual({
      paypalFeeAmount: 49.6,
      netAmount: 1650.4,
    });
  });

  test("an impossible fee is treated as unknown rather than stored", () => {
    expect(resolveInvoiceFees("paypal", 100, 250).paypalFeeAmount).toBeNull();
    expect(resolveInvoiceFees("paypal", 100, -1).paypalFeeAmount).toBeNull();
  });
});

describe("recordInvoicePayment", () => {
  const base = { invoiceId: "inv-1", totalAmount: 1700, platformInvoiceId: "INV2-X", paidAt: new Date() };

  test("a check records a zero fee and never calls PayPal", async () => {
    const { client, updates } = mockClient();
    await recordInvoicePayment(client, { ...base, method: "check" });

    expect(lookupMock).not.toHaveBeenCalled();
    expect(updates).toEqual([{ payment_method: "check", paypal_fee_amount: 0, net_amount: 1700 }]);
  });

  test("a PayPal payment stores the fee PayPal reports", async () => {
    lookupMock.mockResolvedValue({ status: "found", fee: 49.6 });
    const { client, updates } = mockClient();
    await recordInvoicePayment(client, { ...base, method: "paypal" });

    expect(updates).toEqual([
      { payment_method: "paypal", paypal_fee_amount: 49.6, net_amount: 1650.4 },
    ]);
  });

  test("a PayPal payment whose fee is not reported yet is stored as unknown", async () => {
    lookupMock.mockResolvedValue({ status: "pending" });
    const { client, updates } = mockClient();
    await recordInvoicePayment(client, { ...base, method: "paypal" });

    expect(updates).toEqual([
      { payment_method: "paypal", paypal_fee_amount: null, net_amount: null },
    ]);
  });

  test("never throws, so a fee problem cannot undo a recorded payment", async () => {
    lookupMock.mockRejectedValue(new Error("boom"));
    const { client } = mockClient();
    await expect(recordInvoicePayment(client, { ...base, method: "paypal" })).resolves.toBeUndefined();
  });
});

describe("syncInvoicePayPalFees", () => {
  const row = (id: string) => ({
    id,
    total_amount: "1700.00",
    platform_invoice_id: `INV2-${id}`,
    paid_at: "2026-10-13T12:00:00Z",
  });

  test("fills in fees PayPal now reports and leaves the rest waiting", async () => {
    lookupMock
      .mockResolvedValueOnce({ status: "found", fee: 49.6 })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "unavailable", reason: "Transaction Search returned 403" });
    const { client, updates } = mockClient([row("a"), row("b"), row("c")]);

    const result = await syncInvoicePayPalFees(client);

    expect(result).toEqual({
      checked: 3,
      updated: 1,
      pending: 1,
      unavailable: 1,
      firstUnavailableReason: "Transaction Search returned 403",
    });
    expect(updates).toEqual([{ paypal_fee_amount: 49.6, net_amount: 1650.4 }]);
  });

  test("does nothing when no invoice is missing a fee", async () => {
    const { client } = mockClient([]);
    const result = await syncInvoicePayPalFees(client);
    expect(result.checked).toBe(0);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});
