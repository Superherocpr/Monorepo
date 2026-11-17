/**
 * POST /api/invoices/create: travel fee and past-class rules.
 *
 *   - A travel fee is added on top of the price (server-side), becomes its own
 *     PayPal line, and is stored on the invoice, so the edit form can read it
 *     back exactly.
 *   - A class that has already ended skips the spot-capacity check (invoicing
 *     after the fact is normal), while a future class that is full is still
 *     refused.
 *
 * createAndSendInvoice is mocked; its arguments are what is asserted.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const createAndSendInvoiceMock = vi.fn();
vi.mock("@/lib/invoice-actions", () => ({
  createAndSendInvoice: (...args: unknown[]) => createAndSendInvoiceMock(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/effective-role", () => ({ requireApiRole: vi.fn() }));

import { POST } from "@/app/api/invoices/create/route";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const ACTOR_ID = "11111111-1111-1111-1111-111111111111";

/** A session row; `bookings` fill the class so zero spots remain. */
function sessionRow(startsAt: string, endsAt: string, activeBookings: number) {
  return {
    id: "s1",
    max_capacity: 5,
    instructor_id: ACTOR_ID,
    starts_at: startsAt,
    ends_at: endsAt,
    class_types: { name: "BLS", price: 80 },
    locations: { name: "Hall", city: "Sarasota", state: "FL" },
    bookings: Array.from({ length: activeBookings }, (_, i) => ({ id: `b${i}`, cancelled: false })),
    invoices: [],
  };
}

function mockSession(row: ReturnType<typeof sessionRow>) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) c[m] = vi.fn(() => c);
  c.single = vi.fn(() => Promise.resolve({ data: row, error: null }));
  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from: () => c });
}

function post(extra: Record<string, unknown> = {}): Promise<Response> {
  return POST(
    new Request("http://test/api/invoices/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "s1",
        invoiceType: "individual",
        recipientName: "Pat",
        recipientEmail: "pat@example.com",
        studentCount: 2,
        customPrice: false,
        totalAmount: 160,
        amountPerStudent: 80,
        ...extra,
      }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  createAndSendInvoiceMock.mockResolvedValue({ success: true, invoiceId: "i1", invoiceNumber: "INV-00010" });
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: { user: { id: ACTOR_ID }, profile: { first_name: "A", last_name: "B" }, effectiveRole: "super_admin" },
  });
  mockSession(sessionRow("2099-01-01T09:00:00", "2099-01-01T13:00:00", 0));
});

describe("travel fee on a new invoice", () => {
  test("is added to the total, sent as its own line, and stored", async () => {
    const res = await post({ travelFee: 65 });
    expect(res.status).toBe(200);
    const args = createAndSendInvoiceMock.mock.calls[0][1];
    expect(args.totalAmount).toBe(225);
    expect(args.travelFee).toBe(65);
    expect(args.extraLineItems).toEqual([{ name: "Travel Fee", quantity: 1, unitAmount: 65 }]);
    expect(args.customPrice).toBe(true);
  });

  test("a custom price is still before the fee, which is added on top", async () => {
    await post({ customPrice: true, totalAmount: 100, amountPerStudent: 50, travelFee: 65 });
    expect(createAndSendInvoiceMock.mock.calls[0][1].totalAmount).toBe(165);
  });

  test("no fee leaves the invoice exactly as before", async () => {
    await post();
    const args = createAndSendInvoiceMock.mock.calls[0][1];
    expect(args.totalAmount).toBe(160);
    expect(args.travelFee).toBe(0);
    expect(args.extraLineItems).toEqual([]);
    expect(args.customPrice).toBe(false);
  });

  test("a negative or non-numeric fee is rejected", async () => {
    expect((await post({ travelFee: -5 })).status).toBe(400);
    expect((await post({ travelFee: "65" })).status).toBe(400);
    expect(createAndSendInvoiceMock).not.toHaveBeenCalled();
  });
});

describe("spot capacity", () => {
  test("a full upcoming class is refused", async () => {
    mockSession(sessionRow("2099-01-01T09:00:00", "2099-01-01T13:00:00", 5));
    const res = await post();
    expect(res.status).toBe(409);
    expect(createAndSendInvoiceMock).not.toHaveBeenCalled();
  });

  test("a full class that has already ended is invoiced anyway", async () => {
    mockSession(sessionRow("2020-01-01T09:00:00", "2020-01-01T13:00:00", 5));
    const res = await post();
    expect(res.status).toBe(200);
    expect(createAndSendInvoiceMock).toHaveBeenCalledTimes(1);
  });
});
