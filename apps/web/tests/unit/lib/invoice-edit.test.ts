/**
 * Unit tests for lib/invoice-edit.ts and updateBusinessPayPalInvoice() in
 * lib/invoice-actions.ts: the rules behind editing a sent, unpaid invoice.
 *
 * The PayPal call is mocked; there is no real PayPal access.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildEditedLineItems,
  rebuildFlatLineItems,
  computeInvoiceTotal,
  validateInvoiceEdit,
} from "@/lib/invoice-edit";
import { updateBusinessPayPalInvoice } from "@/lib/invoice-actions";

vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return {
    ...actual,
    getPayPalAccessToken: vi.fn().mockResolvedValue("fake-token"),
    getPayPalApiBase: vi.fn().mockReturnValue("https://paypal.test"),
    getPayPalConnectBase: vi.fn().mockReturnValue("https://connect.test"),
  };
});

describe("computeInvoiceTotal", () => {
  test("adds the travel fee to students x price", () => {
    expect(computeInvoiceTotal(3, 79.5, 65)).toBe(303.5);
  });
  test("rounds to cents", () => {
    expect(computeInvoiceTotal(3, 0.1, 0)).toBe(0.3);
  });
});

describe("validateInvoiceEdit", () => {
  const ok = { studentCount: 2, amountPerStudent: 80, travelFee: 65 };
  test("accepts a normal edit", () => {
    expect(validateInvoiceEdit(ok)).toBeNull();
  });
  test("rejects a zero, fractional or non-numeric student count", () => {
    expect(validateInvoiceEdit({ ...ok, studentCount: 0 })).not.toBeNull();
    expect(validateInvoiceEdit({ ...ok, studentCount: 1.5 })).not.toBeNull();
    expect(validateInvoiceEdit({ ...ok, studentCount: "2" })).not.toBeNull();
  });
  test("rejects a negative or non-finite price", () => {
    expect(validateInvoiceEdit({ ...ok, amountPerStudent: -1 })).not.toBeNull();
    expect(validateInvoiceEdit({ ...ok, amountPerStudent: Number.NaN })).not.toBeNull();
  });
  test("rejects a negative or non-numeric travel fee", () => {
    expect(validateInvoiceEdit({ ...ok, travelFee: -5 })).not.toBeNull();
    expect(validateInvoiceEdit({ ...ok, travelFee: "65" })).not.toBeNull();
  });
});

describe("buildEditedLineItems", () => {
  test("adds a Travel Fee line only when there is a fee", () => {
    expect(buildEditedLineItems("BLS", 2, 80, 65)).toEqual([
      { name: "BLS", quantity: 2, unitAmount: 80 },
      { name: "Travel Fee", quantity: 1, unitAmount: 65 },
    ]);
    expect(buildEditedLineItems("BLS", 2, 80, 0)).toEqual([
      { name: "BLS", quantity: 2, unitAmount: 80 },
    ]);
  });
});

describe("validateInvoiceEdit for flat team invoices", () => {
  test("ignores the student count but needs a price above zero", () => {
    expect(
      validateInvoiceEdit({ studentCount: 0, amountPerStudent: 680, travelFee: 65, flat: true })
    ).toBeNull();
    expect(
      validateInvoiceEdit({ studentCount: 0, amountPerStudent: 0, travelFee: 0, flat: true })
    ).not.toBeNull();
  });
});

describe("rebuildFlatLineItems", () => {
  const base = { name: "Corporate Training: BLS (12 people at $85 each)", quantity: 1, unitAmount: 1020 };
  const travel = { name: "Travel & Setup Fee", quantity: 1, unitAmount: 65 };

  test("changes only the amounts and keeps PayPal's line names", () => {
    expect(rebuildFlatLineItems([base, travel], 900, 40)).toEqual([
      { ...base, unitAmount: 900 },
      { ...travel, unitAmount: 40 },
    ]);
  });
  test("drops the travel line when the fee goes to 0", () => {
    expect(rebuildFlatLineItems([base, travel], 900, 0)).toEqual([{ ...base, unitAmount: 900 }]);
  });
  test("adds a travel line with the default name when there was none", () => {
    expect(rebuildFlatLineItems([base], 900, 65)).toEqual([
      { ...base, unitAmount: 900 },
      { name: "Travel & Setup Fee", quantity: 1, unitAmount: 65 },
    ]);
  });
  test("refuses lines it would have to guess about", () => {
    expect(rebuildFlatLineItems([base, { name: "Lunch", quantity: 1, unitAmount: 20 }], 900, 0)).toBeNull();
    expect(rebuildFlatLineItems([], 900, 0)).toBeNull();
  });
});

describe("updateBusinessPayPalInvoice", () => {
  let calls: { url: string; init: RequestInit }[] = [];

  /** Stubs fetch: the GET returns `liveInvoice`, the PUT answers `putStatus`. */
  function mockPayPal(liveInvoice: unknown, getStatus = 200, putStatus = 200): void {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        const isGet = init.method === "GET";
        const status = isGet ? getStatus : putStatus;
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(isGet ? liveInvoice : {}),
          text: () => Promise.resolve(""),
        });
      })
    );
  }
  beforeEach(() => calls = []);
  afterEach(() => vi.unstubAllGlobals());

  const params = {
    platformInvoiceId: "INV2-AAAA",
    recipientEmail: "new@example.com",
    items: [{ name: "BLS", quantity: 2, unitAmount: 80 }],
  };
  const live = {
    status: "SENT",
    detail: { invoice_number: "0001", note: "INV-00001" },
    invoicer: { business_name: "SuperHeroCPR" },
    configuration: { allow_tip: false },
    amount: { value: "100.00" },
    links: [],
  };

  test("PUTs a full replace with send_to_recipient and no read-only fields", async () => {
    mockPayPal(live);
    expect(await updateBusinessPayPalInvoice(params)).toBeNull();
    const put = calls[1];
    expect(put.init.method).toBe("PUT");
    expect(put.url).toBe("https://paypal.test/v2/invoicing/invoices/INV2-AAAA?send_to_recipient=true");
    const body = JSON.parse(String(put.init.body));
    expect(body.detail).toEqual(live.detail);
    expect(body.primary_recipients[0].billing_info.email_address).toBe("new@example.com");
    expect(body.items[0]).toEqual({
      name: "BLS",
      quantity: "2",
      unit_amount: { currency_code: "USD", value: "80.00" },
    });
    expect(body.status).toBeUndefined();
    expect(body.amount).toBeUndefined();
    expect(body.links).toBeUndefined();
  });

  test("builds items from PayPal's current lines when given a function", async () => {
    mockPayPal({
      ...live,
      items: [
        { name: "Corporate Training", quantity: "1", unit_amount: { value: "680.00" } },
        { name: "Travel & Setup Fee", quantity: "1", unit_amount: { value: "65.00" } },
      ],
    });
    let seen: unknown;
    const result = await updateBusinessPayPalInvoice({
      ...params,
      items: (current) => {
        seen = current;
        return rebuildFlatLineItems(current, 700, 0);
      },
    });
    expect(result).toBeNull();
    expect(seen).toEqual([
      { name: "Corporate Training", quantity: 1, unitAmount: 680 },
      { name: "Travel & Setup Fee", quantity: 1, unitAmount: 65 },
    ]);
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.items).toHaveLength(1);
    expect(body.items[0].unit_amount.value).toBe("700.00");
  });

  test("refuses the edit, without a PUT, when the builder returns null", async () => {
    mockPayPal(live);
    const result = await updateBusinessPayPalInvoice({ ...params, items: () => null });
    expect(result).toMatch(/cannot be edited here/);
    expect(calls).toHaveLength(1);
  });

  test("refuses an invoice PayPal already shows as PAID, without sending the PUT", async () => {
    mockPayPal({ ...live, status: "PAID" });
    const result = await updateBusinessPayPalInvoice(params);
    expect(result).toMatch(/PAID/);
    expect(calls).toHaveLength(1);
  });

  test("returns a fixed reason when PayPal rejects the update", async () => {
    mockPayPal(live, 200, 422);
    expect(await updateBusinessPayPalInvoice(params)).toMatch(/rejected/);
  });

  test("returns a reason when the invoice cannot be fetched", async () => {
    mockPayPal(live, 404);
    expect(await updateBusinessPayPalInvoice(params)).toMatch(/could not find/);
  });
});
