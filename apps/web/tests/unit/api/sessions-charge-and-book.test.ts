/**
 * Unit tests for POST /api/sessions/[id]/charge-and-book
 * (app/api/sessions/[id]/charge-and-book/route.ts)
 *
 * The property under test is the one the feature exists for: an instructor
 * cannot end up with a student added to a class who has not paid. Every failure
 * mode is therefore checked for what it did NOT do — no booking on a decline,
 * no booking without a settled capture, a refund whenever a capture happened
 * but the reservation did not.
 *
 * Also covers the ownership gate (an instructor charging into someone else's
 * class) and the pre-capture guards that avoid charge-then-refund churn.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server       — prevents Next.js cookies() runtime requirement
 *   @/lib/auth/effective-role   — role + view-as resolution
 *   @/lib/paypal                — token/base only; capture evaluation stays real
 *   global fetch                — PayPal capture and refund HTTP calls
 *   @/lib/session-pricing       — list price used for the audit stamp
 *   @/lib/instructor-earnings   — no-op, verified via spy
 *   @/lib/payout-trigger        — no-op
 *   @/lib/assistant-reminder    — no-op
 *   resend                      — prevents real email sends
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/sessions/[id]/charge-and-book/route";

const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const CUSTOMER_ID = "44444444-4444-4444-4444-444444444444";
const INSTRUCTOR_ID = "55555555-5555-5555-5555-555555555555";
const OTHER_INSTRUCTOR_ID = "66666666-6666-6666-6666-666666666666";
const ORDER_ID = "ORDER-1";
const CAPTURE_ID = "CAPTURE-1";
const AMOUNT = 75;

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/auth/effective-role", () => ({ requireApiRole: vi.fn() }));

// Only the network-touching helpers are stubbed. evaluateCaptureOutcome keeps
// its real implementation: it is the guard that decides whether money actually
// moved (THREAT-054), so mocking it would make the decline tests vacuous.
vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return {
    ...actual,
    getPayPalAccessToken: vi.fn().mockResolvedValue("fake-token"),
    getPayPalApiBase: vi.fn().mockReturnValue("https://paypal.test"),
  };
});

// Literals rather than the constants above: vi.mock factories are hoisted
// above the const declarations, so referencing them here throws at import time.
vi.mock("@/lib/session-pricing", () => ({
  getSessionPricing: vi.fn().mockResolvedValue({
    found: true,
    basePrice: 75,
    rawPrice: 75,
    discountPercent: 0,
    className: "BLS Provider",
    instructorId: "55555555-5555-5555-5555-555555555555",
  }),
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
    return {
      emails: { send: vi.fn().mockResolvedValue({ data: { id: "email-id" }, error: null }) },
    };
  }),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { recordBookingEarning } from "@/lib/instructor-earnings";
// Not mocked: class times are floating wall-clock values since migration 0060,
// so the route compares ends_at against floatingNow() rather than a real
// instant. Fixtures are built in that same space — offsetting from real
// Date.now() would make these tests pass or fail by the UTC offset.
import { floatingNow } from "@/lib/business-time";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown; count?: number }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.insert = vi.fn(self);
  c.update = vi.fn(self);
  c.eq = vi.fn(self);
  c.not = vi.fn(self);
  c.single = vi.fn(() => Promise.resolve(result));
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

/** A floating wall-clock timestamp `hours` from the business "now". */
function floatingHoursFromNow(hours: number): string {
  return new Date(new Date(floatingNow()).getTime() + hours * 60 * 60 * 1000).toISOString();
}

const FUTURE = floatingHoursFromNow(2);

const SESSION_ROW = {
  id: SESSION_ID,
  instructor_id: INSTRUCTOR_ID,
  status: "scheduled",
  approval_status: "approved",
  starts_at: FUTURE,
  ends_at: FUTURE,
  max_capacity: 10,
  class_types: { name: "BLS Provider" },
  locations: { name: "Main", address: "1 St", city: "Tampa", state: "FL", zip: "33601" },
  profiles: { first_name: "Alex", last_name: "Instructor", email: "i@x.com", phone: null },
};

/** Signs the request in as an instructor (the default) or another role. */
function mockActor(role = "instructor", userId = INSTRUCTOR_ID) {
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: {
      user: { id: userId },
      profile: { first_name: "Alex", last_name: "Instructor" },
      effectiveRole: role,
      realRole: role,
    },
  });
}

/**
 * Wires admin.from()/rpc() for this route's known table reads.
 * `duplicate` seeds an existing booking; `bookedCount` drives the capacity gate.
 */
function mockAdminClient(
  opts: {
    sessionRow?: unknown;
    duplicate?: unknown;
    bookedCount?: number;
    bookSpotResult?: { data: unknown; error: unknown };
  } = {}
) {
  const rpc = vi.fn().mockResolvedValue(opts.bookSpotResult ?? { data: "booking-1", error: null });

  // bookings is read three times in order: duplicate probe, capacity count,
  // then the post-insert audit stamp.
  let bookingsCall = 0;
  const from = vi.fn((table: string) => {
    if (table === "class_sessions") {
      return chain({ data: "sessionRow" in opts ? opts.sessionRow : SESSION_ROW, error: null });
    }
    if (table === "bookings") {
      bookingsCall += 1;
      if (bookingsCall === 1) return chain({ data: opts.duplicate ?? null, error: null });
      if (bookingsCall === 2) {
        return chain({ data: null, error: null, count: opts.bookedCount ?? 0 });
      }
      return chain({ data: null, error: null });
    }
    if (table === "invoices") return chain({ data: [], error: null });
    if (table === "payments") return chain({ data: { id: "payment-1" }, error: null });
    if (table === "profiles") {
      return chain({
        data: { first_name: "Sam", last_name: "Student", email: "s@x.com" },
        error: null,
      });
    }
    return chain({ data: null, error: null });
  });

  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from, rpc });
  return { from, rpc };
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request(`https://superherocpr.com/api/sessions/${SESSION_ID}/charge-and-book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ id: SESSION_ID }) };
}

const baseBody = { paypalOrderId: ORDER_ID, customerId: CUSTOMER_ID, amount: AMOUNT };

/**
 * A PayPal capture response body with the given status.
 * `value` accepts a string so a fixture can carry sub-cent precision, which a
 * number formatted to two decimals cannot.
 */
function captureBody(status: string, value: number | string = AMOUNT) {
  return {
    purchase_units: [
      {
        payments: {
          captures: [
            {
              id: CAPTURE_ID,
              status,
              amount: {
                currency_code: "USD",
                value: typeof value === "string" ? value : value.toFixed(2),
              },
            },
          ],
        },
      },
    ],
  };
}

/** Queues a PayPal HTTP response on the global fetch mock. */
function queueResponse(fetchMock: ReturnType<typeof vi.fn>, ok: boolean, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status: ok ? 201 : 422,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe("POST /api/sessions/[id]/charge-and-book", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockActor();
  });

  test("returns 400 when the PayPal order id is missing", async () => {
    const res = await POST(makeRequest({ customerId: CUSTOMER_ID, amount: AMOUNT }), params());
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a non-positive amount before touching PayPal", async () => {
    const res = await POST(makeRequest({ ...baseBody, amount: 0 }), params());
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects an amount above the manual charge limit — a decimal slip", async () => {
    const res = await POST(makeRequest({ ...baseBody, amount: 7500 }), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/decimal point/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("returns 404 when the session doesn't exist", async () => {
    mockAdminClient({ sessionRow: null });
    const res = await POST(makeRequest(baseBody), params());
    expect(res.status).toBe(404);
  });

  test("forbids an instructor charging into another instructor's class", async () => {
    mockActor("instructor", OTHER_INSTRUCTOR_ID);
    const { rpc } = mockAdminClient();

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  test("allows a manager to charge into a class they don't teach", async () => {
    mockActor("manager", OTHER_INSTRUCTOR_ID);
    const { rpc } = mockAdminClient();
    queueResponse(fetchMock, true, captureBody("COMPLETED"));

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalled();
  });

  test("refuses a cancelled session without charging", async () => {
    mockAdminClient({ sessionRow: { ...SESSION_ROW, status: "cancelled" } });
    const res = await POST(makeRequest(baseBody), params());
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("refuses a class that has already ended without charging", async () => {
    mockAdminClient({
      sessionRow: { ...SESSION_ROW, ends_at: floatingHoursFromNow(-1) },
    });
    const res = await POST(makeRequest(baseBody), params());
    expect(res.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("allows a class that has started but not ended — the walk-in case", async () => {
    mockAdminClient({
      sessionRow: {
        ...SESSION_ROW,
        starts_at: floatingHoursFromNow(-0.5),
        ends_at: floatingHoursFromNow(0.5),
      },
    });
    queueResponse(fetchMock, true, captureBody("COMPLETED"));

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(200);
  });

  test("rejects a duplicate booking before charging the card", async () => {
    // book_spot's own duplicate guard only covers booking_source 'online', so
    // this route has to catch it — and catching it pre-capture avoids taking
    // money we would immediately have to refund.
    const { rpc } = mockAdminClient({ duplicate: { id: "existing-booking" } });

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  test("rejects a full class before charging the card", async () => {
    const { rpc } = mockAdminClient({ bookedCount: 10 });

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/full/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  test("creates NO booking when the card is declined at the HTTP level", async () => {
    const { rpc } = mockAdminClient();
    queueResponse(fetchMock, false, {
      details: [{ issue: "PAYMENT_DENIED" }],
    });

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.declined).toBe(true);
    expect(json.error).toMatch(/NOT added/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(recordBookingEarning).not.toHaveBeenCalled();
  });

  test("creates NO booking when the capture returns 201 but did not settle", async () => {
    // A declined card still comes back HTTP 201 with a full amount breakdown —
    // capture status is the only trustworthy signal (THREAT-054).
    const { rpc } = mockAdminClient();
    queueResponse(fetchMock, true, captureBody("DECLINED"));

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(402);
    expect(rpc).not.toHaveBeenCalled();
    expect(recordBookingEarning).not.toHaveBeenCalled();
  });

  test("creates NO booking when the capture is still PENDING", async () => {
    const { rpc } = mockAdminClient();
    queueResponse(fetchMock, true, captureBody("PENDING"));

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.declined).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("refunds and books nothing when PayPal captured a different amount", async () => {
    const { rpc } = mockAdminClient();
    queueResponse(fetchMock, true, captureBody("COMPLETED", 5));
    queueResponse(fetchMock, true, {}); // refund

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
    const refundCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes(`/payments/captures/${CAPTURE_ID}/refund`)
    );
    expect(refundCall).toBeDefined();
    expect(recordBookingEarning).not.toHaveBeenCalled();
  });

  test("refunds the capture when the class fills up between the check and book_spot", async () => {
    mockAdminClient({
      bookSpotResult: { data: null, error: { message: "session_full" } },
    });
    queueResponse(fetchMock, true, captureBody("COMPLETED"));
    queueResponse(fetchMock, true, {}); // refund

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/refunded/i);
    const refundCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes(`/payments/captures/${CAPTURE_ID}/refund`)
    );
    expect(refundCall).toBeDefined();
    expect(recordBookingEarning).not.toHaveBeenCalled();
  });

  test("captures, books as 'manual', and credits the session instructor on the happy path", async () => {
    const { rpc, from } = mockAdminClient();
    queueResponse(fetchMock, true, captureBody("COMPLETED"));

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bookingId).toBe("booking-1");

    expect(rpc).toHaveBeenCalledWith("book_spot", {
      p_session_id: SESSION_ID,
      p_customer_id: CUSTOMER_ID,
      p_booking_source: "manual",
      p_invoice_id: null,
    });

    // Earning goes to the session's instructor, not whoever clicked.
    expect(recordBookingEarning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        instructorId: INSTRUCTOR_ID,
        bookingId: "booking-1",
        grossAmount: AMOUNT,
      })
    );

    // No refund on a successful booking.
    const refundCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/refund")
    );
    expect(refundCall).toBeUndefined();

    const paymentInsert = from.mock.results
      .map((r) => r.value as Record<string, ReturnType<typeof vi.fn>>)
      .find((c) => c.insert?.mock.calls.length);
    expect(paymentInsert?.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: "booking-1",
        customer_id: CUSTOMER_ID,
        amount: AMOUNT,
        status: "completed",
        paypal_transaction_id: CAPTURE_ID,
      })
    );
  });

  test("records the amount PayPal actually captured, not the one submitted", async () => {
    // Inside the rounding tolerance, so this is accepted rather than reversed —
    // but the money recorded must be PayPal's figure, not the submitted one.
    mockAdminClient();
    queueResponse(fetchMock, true, captureBody("COMPLETED", "75.005"));

    const res = await POST(makeRequest(baseBody), params());

    expect(res.status).toBe(200);
    expect(recordBookingEarning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ grossAmount: 75.005 })
    );
  });

  test("stamps the booking with the acting user and an audit reason", async () => {
    const { from } = mockAdminClient();
    queueResponse(fetchMock, true, captureBody("COMPLETED"));

    await POST(makeRequest(baseBody), params());

    const stamped = from.mock.results
      .map((r) => r.value as Record<string, ReturnType<typeof vi.fn>>)
      .find((c) => c.update?.mock.calls.length);
    expect(stamped?.update).toHaveBeenCalledWith(
      expect.objectContaining({
        created_by: INSTRUCTOR_ID,
        manual_booking_reason: expect.stringContaining("Added and charged"),
      })
    );
  });

  test("notes the list price on the booking when charged off-price", async () => {
    const { from } = mockAdminClient();
    queueResponse(fetchMock, true, captureBody("COMPLETED", 40));

    await POST(makeRequest({ ...baseBody, amount: 40 }), params());

    const stamped = from.mock.results
      .map((r) => r.value as Record<string, ReturnType<typeof vi.fn>>)
      .find((c) => c.update?.mock.calls.length);
    expect(stamped?.update).toHaveBeenCalledWith(
      expect.objectContaining({
        manual_booking_reason: expect.stringContaining("list price $75.00"),
      })
    );
  });
});
