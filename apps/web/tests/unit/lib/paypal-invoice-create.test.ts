/**
 * Unit tests for createBusinessPayPalInvoice() in lib/invoice-actions.ts.
 *
 * These exist for one specific regression. PayPal's POST /v2/invoicing/invoices
 * answers with the full invoice object (carrying a top-level `id`) only when the
 * request sends `Prefer: return=representation`; its DEFAULT answer is the
 * minimal `{ rel, href, method }` shape, where the id is the last path segment
 * of `href`.
 *
 * This module sent no Prefer header and read `body.id`. The result was that
 * EVERY real invoice creation drew a 201 from PayPal, found no id, and reported
 * "we couldn't create the invoice in PayPal" — while leaving an unsent draft on
 * the merchant account. No invoice had ever been created in production, and two
 * company team bookings went unbilled before anyone noticed.
 *
 * So: assert the header is sent, and assert BOTH response shapes still yield an
 * id, so a merchant account that ignores the header cannot resurrect this.
 *
 * The network is mocked; no real PayPal access.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createBusinessPayPalInvoice } from "@/lib/invoice-actions";

vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return {
    ...actual,
    getPayPalAccessToken: vi.fn().mockResolvedValue("fake-token"),
    getPayPalApiBase: vi.fn().mockReturnValue("https://paypal.test"),
    getPayPalConnectBase: vi.fn().mockReturnValue("https://connect.test"),
  };
});

const PAYPAL_INVOICE_ID = "INV2-Z56S-5LLA-Q52L-CPZ5";

/** Standard params for a flat corporate invoice. */
const params = {
  recipientEmail: "contact@company.example",
  invoiceNumber: "INV-00001",
  items: [{ name: "Corporate Training — BLS", quantity: 1, unitAmount: 1020 }],
};

/** Captured requests, so header and URL assertions can be made after the call. */
let calls: { url: string; init: RequestInit }[] = [];

/**
 * Installs a fetch stub that answers the create call with `createBody` and the
 * send call with 200 OK.
 * @param createBody - The JSON body PayPal returns from the create call.
 * @param createStatus - HTTP status for the create call.
 * @param sendStatus - HTTP status for the follow-up send call.
 */
function mockPayPal(createBody: unknown, createStatus = 201, sendStatus = 202): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const isSend = String(url).endsWith("/send");
      const status = isSend ? sendStatus : createStatus;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(isSend ? {} : createBody),
        text: () => Promise.resolve(JSON.stringify(isSend ? {} : createBody)),
      } as unknown as Response);
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createBusinessPayPalInvoice", () => {
  test("asks PayPal for the full representation, not the minimal href shape", async () => {
    mockPayPal({ id: PAYPAL_INVOICE_ID });

    await createBusinessPayPalInvoice(params);

    const createCall = calls.find((c) => !c.url.endsWith("/send"));
    const headers = createCall?.init.headers as Record<string, string>;
    expect(headers.Prefer).toBe("return=representation");
  });

  test("reads the id from the representation shape", async () => {
    mockPayPal({ id: PAYPAL_INVOICE_ID, status: "DRAFT" });

    const result = await createBusinessPayPalInvoice(params);

    expect(result.error).toBeNull();
    expect(result.platformInvoiceId).toBe(PAYPAL_INVOICE_ID);
    expect(result.paymentLink).toBe(`https://connect.test/invoice/p/#${PAYPAL_INVOICE_ID}`);
  });

  test("reads the id out of href when PayPal returns the minimal shape", async () => {
    // The exact body that used to produce a silent failure.
    mockPayPal({
      rel: "self",
      href: `https://api-m.paypal.com/v2/invoicing/invoices/${PAYPAL_INVOICE_ID}`,
      method: "GET",
    });

    const result = await createBusinessPayPalInvoice(params);

    expect(result.error).toBeNull();
    expect(result.platformInvoiceId).toBe(PAYPAL_INVOICE_ID);
  });

  test("still sends the invoice after recovering the id from href", async () => {
    mockPayPal({
      rel: "self",
      href: `https://api-m.paypal.com/v2/invoicing/invoices/${PAYPAL_INVOICE_ID}`,
      method: "GET",
    });

    await createBusinessPayPalInvoice(params);

    expect(calls.some((c) => c.url === `https://paypal.test/v2/invoicing/invoices/${PAYPAL_INVOICE_ID}/send`)).toBe(true);
  });

  test("reports a reason rather than failing silently when no id can be found", async () => {
    mockPayPal({ rel: "self", method: "GET" });

    const result = await createBusinessPayPalInvoice(params);

    expect(result.platformInvoiceId).toBeNull();
    expect(result.error).toMatch(/no invoice id/i);
  });

  test("reports the stranded draft when the send call fails", async () => {
    mockPayPal({ id: PAYPAL_INVOICE_ID }, 201, 500);

    const result = await createBusinessPayPalInvoice(params);

    expect(result.platformInvoiceId).toBeNull();
    expect(result.strandedDraftId).toBe(PAYPAL_INVOICE_ID);
    expect(result.error).toMatch(/would not send/i);
  });

  test("reports a rejected create with its status", async () => {
    mockPayPal({ name: "UNPROCESSABLE_ENTITY" }, 422);

    const result = await createBusinessPayPalInvoice(params);

    expect(result.platformInvoiceId).toBeNull();
    expect(result.error).toMatch(/422/);
  });
});
