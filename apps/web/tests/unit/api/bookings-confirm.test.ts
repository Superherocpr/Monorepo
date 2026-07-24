/**
 * Unit tests for POST /api/bookings/confirm (app/api/bookings/confirm/route.ts)
 *
 * Covers the price-integrity gate (THREAT-013), the automatic-refund paths when
 * book_spot rejects a reservation — including the new already_booked case
 * (THREAT-047) — and the happy path's booking/payment/earnings writes.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server       — prevents Next.js cookies() runtime requirement
 *   @/lib/paypal                — PayPal access token / API base (avoids real network auth)
 *   global fetch                — PayPal capture/refund HTTP calls
 *   @/lib/instructor-earnings   — no-ops, verified via spy
 *   @/lib/payout-trigger        — no-op
 *   @/lib/assistant-reminder    — no-op
 *   resend                      — prevents real email sends
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/bookings/confirm/route";

const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const CUSTOMER_ID = "44444444-4444-4444-4444-444444444444";
const INSTRUCTOR_ID = "55555555-5555-5555-5555-555555555555";
const ORDER_ID = "ORDER-1";
const CAPTURE_ID = "CAPTURE-1";
const PRICE = 100;

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/paypal", () => ({
  getPayPalAccessToken: vi.fn().mockResolvedValue("fake-token"),
  getPayPalApiBase: vi.fn().mockReturnValue("https://paypal.test"),
}));

vi.mock("@/lib/instructor-earnings", () => ({
  recordBookingEarning: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/payout-trigger", () => ({
  maybeTriggerImmediatePayout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/assistant-reminder", () => ({
  maybeSendAssistantReminder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function Resend() {
    return { emails: { send: vi.fn().mockResolvedValue({ data: { id: "email-id" }, error: null }) } };
  }),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { recordBookingEarning } from "@/lib/instructor-earnings";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.insert = vi.fn(self);
  c.eq = vi.fn(self);
  c.single = vi.fn(() => Promise.resolve(result));
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

const SESSION_ROW = { instructor_id: INSTRUCTOR_ID, class_types: { price: PRICE } };

/** Sets up admin.from()/rpc() to hand back fixed responses for this route's known calls. */
function mockAdminClient(opts: {
  sessionRow?: unknown;
  bookSpotResult?: { data: unknown; error: unknown };
  paymentInsertResult?: { data: unknown; error: unknown };
}) {
  const rpc = vi.fn().mockResolvedValue(opts.bookSpotResult ?? { data: "booking-1", error: null });
  const from = vi.fn((table: string) => {
    if (table === "class_sessions") {
      return chain({ data: "sessionRow" in opts ? opts.sessionRow : SESSION_ROW, error: null });
    }
    if (table === "payments") {
      return chain(opts.paymentInsertResult ?? { data: { id: "payment-1" }, error: null });
    }
    if (table === "profiles") {
      return chain({ data: { first_name: "Alex", last_name: "Instructor", email: "i@x.com", phone: null }, error: null });
    }
    return chain({ data: null, error: null });
  });
  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from, rpc });
  return { from, rpc };
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("https://superherocpr.com/api/bookings/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  paypalOrderId: ORDER_ID,
  sessionId: SESSION_ID,
  customerId: CUSTOMER_ID,
  amount: PRICE,
};

describe("POST /api/bookings/confirm", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  test("returns 400 when required fields are missing", async () => {
    const res = await POST(makeRequest({ sessionId: SESSION_ID }));
    expect(res.status).toBe(400);
  });

  test("returns 404 when the session doesn't exist", async () => {
    mockAdminClient({ sessionRow: null });
    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(404);
  });

  test("rejects a client-supplied amount that doesn't match the server price (THREAT-013) without ever capturing", async () => {
    mockAdminClient({});
    const res = await POST(makeRequest({ ...baseBody, amount: 1 }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/pricing has changed/i);
    // The route must reject before touching PayPal at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("captures payment, books the spot, and records earnings on the happy path", async () => {
    const { rpc } = mockAdminClient({});
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        purchase_units: [{ payments: { captures: [{ id: CAPTURE_ID, amount: { value: "100.00" } }] } }],
      }),
    });

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bookingId).toBe("booking-1");
    expect(rpc).toHaveBeenCalledWith(
      "book_spot",
      expect.objectContaining({ p_session_id: SESSION_ID, p_customer_id: CUSTOMER_ID })
    );
    expect(recordBookingEarning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ instructorId: INSTRUCTOR_ID, grossAmount: PRICE })
    );
  });

  test("returns 502 and does not book when PayPal capture fails", async () => {
    mockAdminClient({});
    fetchMock.mockResolvedValueOnce({ ok: false, text: async () => "capture declined" });

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(502);
  });

  test("auto-refunds and returns 409 'class filled up' when book_spot reports session_full", async () => {
    mockAdminClient({ bookSpotResult: { data: null, error: { message: "session_full" } } });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          purchase_units: [{ payments: { captures: [{ id: CAPTURE_ID, amount: { value: "100.00" } }] } }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // refund call

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/filled up/i);
    // capture + refund = 2 PayPal calls
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain(`/v2/payments/captures/${CAPTURE_ID}/refund`);
  });

  test("auto-refunds and returns a clear message when book_spot reports already_booked (THREAT-047)", async () => {
    mockAdminClient({ bookSpotResult: { data: null, error: { message: "already_booked" } } });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          purchase_units: [{ payments: { captures: [{ id: CAPTURE_ID, amount: { value: "100.00" } }] } }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // refund call

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already booked/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain(`/v2/payments/captures/${CAPTURE_ID}/refund`);
  });

  test("reverses the transaction if PayPal's captured amount doesn't match the expected price", async () => {
    mockAdminClient({});
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        // PayPal reports it captured $1 despite the order being created for $100 — must never happen, but defend anyway.
        json: async () => ({
          purchase_units: [{ payments: { captures: [{ id: CAPTURE_ID, amount: { value: "1.00" } }] } }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // refund call

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/mismatch/i);
    expect(fetchMock.mock.calls[1][0]).toContain(`/v2/payments/captures/${CAPTURE_ID}/refund`);
  });

  test("does not fail the request when the payment record insert fails (booking already succeeded)", async () => {
    mockAdminClient({ paymentInsertResult: { data: null, error: { message: "db down" } } });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        purchase_units: [{ payments: { captures: [{ id: CAPTURE_ID, amount: { value: "100.00" } }] } }],
      }),
    });

    const res = await POST(makeRequest(baseBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
