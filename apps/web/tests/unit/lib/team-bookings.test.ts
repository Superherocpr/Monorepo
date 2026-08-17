/**
 * Unit tests for lib/team-bookings.ts
 *
 * Focus is on the invariants that protect money and headcount:
 *   - the pricing shape validator mirrors the DB CHECK constraint, so a bad
 *     payload is rejected before any PayPal invoice is raised
 *   - the public share-token view never leaks attendee emails or ids
 *   - seat maths and the closed/closedReason gate match book_spot's rules
 *   - the cancellation phone follows the creator, per the agreed behaviour
 * The Supabase client is mocked; no real DB access.
 */
import { describe, test, expect, vi } from "vitest";
import {
  validateTeamPricing,
  generateShareToken,
  getTeamBookingByShareToken,
  MAIN_CANCELLATION_PHONE,
  type TeamBookingDetails,
} from "@/lib/team-bookings";

const SESSION_ID = "55555555-5555-5555-5555-555555555555";
const TEAM_ID = "66666666-6666-6666-6666-666666666666";
const CREATOR_ID = "77777777-7777-7777-7777-777777777777";
const INSTRUCTOR_ID = "88888888-8888-8888-8888-888888888888";
const TOKEN = "a0000000-0000-4000-8000-000000000000";

/** Minimal valid details, overridable per test. */
function details(overrides: Partial<TeamBookingDetails> = {}): TeamBookingDetails {
  return {
    companyName: "Acme Hospital",
    contactName: "Dana Reyes",
    contactEmail: "dana@acme.example",
    paymentMode: "per_seat",
    pricePerSeat: 80,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateTeamPricing
// ---------------------------------------------------------------------------

describe("validateTeamPricing", () => {
  test("accepts a per-seat booking with only a per-seat price", () => {
    expect(validateTeamPricing(details())).toBeNull();
  });

  test("accepts a company booking with only a flat total", () => {
    expect(
      validateTeamPricing(
        details({ paymentMode: "company", pricePerSeat: null, totalPrice: 1200 })
      )
    ).toBeNull();
  });

  test("accepts a free per-seat booking (company covers it out of band)", () => {
    expect(validateTeamPricing(details({ pricePerSeat: 0 }))).toBeNull();
  });

  test("rejects a per-seat booking with no price", () => {
    expect(validateTeamPricing(details({ pricePerSeat: null }))).toMatch(/price per seat is required/i);
  });

  test("rejects a company booking with no total", () => {
    expect(
      validateTeamPricing(details({ paymentMode: "company", pricePerSeat: null, totalPrice: null }))
    ).toMatch(/total price is required/i);
  });

  test("rejects a company booking priced at zero", () => {
    expect(
      validateTeamPricing(details({ paymentMode: "company", pricePerSeat: null, totalPrice: 0 }))
    ).toMatch(/greater than zero/i);
  });

  test("rejects a negative per-seat price", () => {
    expect(validateTeamPricing(details({ pricePerSeat: -5 }))).toMatch(/cannot be negative/i);
  });

  test("rejects carrying both prices at once, in both directions", () => {
    expect(validateTeamPricing(details({ pricePerSeat: 80, totalPrice: 1200 }))).toMatch(
      /cannot also carry a flat total/i
    );
    expect(
      validateTeamPricing(details({ paymentMode: "company", pricePerSeat: 80, totalPrice: 1200 }))
    ).toMatch(/cannot also carry a per-seat price/i);
  });

  test("rejects a non-finite price rather than passing NaN to PayPal", () => {
    expect(validateTeamPricing(details({ pricePerSeat: Number.NaN }))).toMatch(/required/i);
  });
});

// ---------------------------------------------------------------------------
// generateShareToken
// ---------------------------------------------------------------------------

describe("generateShareToken", () => {
  test("produces a unique, non-enumerable UUID each call", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateShareToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
  });
});

// ---------------------------------------------------------------------------
// getTeamBookingByShareToken
// ---------------------------------------------------------------------------

/** Records the select() string used per table, so query shape can be asserted. */
const selectsByTable = new Map<string, string[]>();

/**
 * Per-table canned responses; each `.from()` chain is thenable and terminal-aware.
 * Pass an `errors` map to simulate a failed query for a given table.
 */
function mockSupabase(
  tables: Record<string, unknown>,
  errors: Record<string, unknown> = {}
) {
  selectsByTable.clear();
  const from = vi.fn((table: string) => {
    const result = { data: tables[table] ?? null, error: errors[table] ?? null };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = vi.fn((cols?: string) => {
      if (typeof cols === "string") {
        selectsByTable.set(table, [...(selectsByTable.get(table) ?? []), cols]);
      }
      return chain;
    });
    for (const method of ["eq", "not", "order", "in"]) {
      chain[method] = vi.fn(self);
    }
    chain.maybeSingle = vi.fn(() => Promise.resolve(result));
    chain.single = vi.fn(() => Promise.resolve(result));
    // Awaiting the chain directly (list queries) resolves to the same result.
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return chain;
  });
  return { from } as unknown as Parameters<typeof getTeamBookingByShareToken>[0];
}

/** A team_bookings row joined to its session, as the lookup query returns it. */
function teamRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEAM_ID,
    company_name: "Acme Hospital",
    payment_mode: "per_seat",
    price_per_seat: "80.00",
    session_id: SESSION_ID,
    created_by: CREATOR_ID,
    class_sessions: {
      id: SESSION_ID,
      starts_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      ends_at: new Date(Date.now() + 7 * 864e5 + 2 * 36e5).toISOString(),
      max_capacity: 10,
      status: "scheduled",
      approval_status: "approved",
      instructor_id: INSTRUCTOR_ID,
      class_types: { name: "BLS Provider" },
      locations: {
        name: "Acme HQ",
        address: "1 Main St",
        city: "Tampa",
        state: "FL",
        zip: "33602",
      },
    },
    ...overrides,
  };
}

const bookingRow = (first: string, last: string, email: string) => ({
  customer_id: "irrelevant",
  created_at: "2026-08-01T00:00:00Z",
  profiles: { first_name: first, last_name: last, email },
});

describe("getTeamBookingByShareToken", () => {
  test("returns null for an unknown token", async () => {
    const supabase = mockSupabase({ team_bookings: null });
    expect(await getTeamBookingByShareToken(supabase, "nope")).toBeNull();
  });

  test("exposes attendee names only — never emails", async () => {
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: [
        bookingRow("Jane", "Smith", "jane@acme.example"),
        bookingRow("John", "Doe", "john@acme.example"),
      ],
      invoices: [],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: "555-0100", role: "manager" },
    });

    const view = await getTeamBookingByShareToken(supabase, TOKEN);

    expect(view?.attendees).toEqual([
      { firstName: "Jane", lastName: "Smith" },
      { firstName: "John", lastName: "Doe" },
    ]);
    expect(view?.attendeeCount).toBe(2);
    // The whole payload must not carry an email address anywhere.
    expect(JSON.stringify(view)).not.toMatch(/@acme\.example/);
  });

  test("subtracts bookings and unpaid invoice seats from capacity, like book_spot", async () => {
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: [bookingRow("Jane", "Smith", "j@x.example")],
      // A non-team invoice on the same session still reserves seats.
      invoices: [{ student_count: 3, status: "sent" }],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: null, role: "manager" },
    });

    const view = await getTeamBookingByShareToken(supabase, TOKEN);

    expect(view?.maxCapacity).toBe(10);
    expect(view?.spotsRemaining).toBe(6); // 10 − 1 booking − 3 invoice seats
    expect(view?.closed).toBe(false);
  });

  test("team invoices with student_count 0 consume no seats", async () => {
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: [],
      invoices: [{ student_count: 0, status: "sent" }],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: null, role: "manager" },
    });

    expect((await getTeamBookingByShareToken(supabase, TOKEN))?.spotsRemaining).toBe(10);
  });

  test("closes signups when the class is full", async () => {
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: Array.from({ length: 10 }, (_, i) => bookingRow(`P${i}`, "X", "p@x.example")),
      invoices: [],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: null, role: "manager" },
    });

    const view = await getTeamBookingByShareToken(supabase, TOKEN);
    expect(view?.spotsRemaining).toBe(0);
    expect(view?.closedReason).toBe("full");
  });

  test.each([
    ["cancelled session", { status: "cancelled" }, "cancelled"],
    ["unapproved session", { approval_status: "pending_approval" }, "unapproved"],
    ["past session", { starts_at: new Date(Date.now() - 864e5).toISOString() }, "past"],
  ])("closes signups for a %s", async (_label, sessionOverride, expected) => {
    const base = teamRow();
    const supabase = mockSupabase({
      team_bookings: {
        ...base,
        class_sessions: { ...(base.class_sessions as object), ...sessionOverride },
      },
      bookings: [],
      invoices: [],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: null, role: "manager" },
    });

    const view = await getTeamBookingByShareToken(supabase, TOKEN);
    expect(view?.closed).toBe(true);
    expect(view?.closedReason).toBe(expected);
  });

  test("uses the instructor's phone when an instructor created the booking", async () => {
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: [],
      invoices: [],
      profiles: { first_name: "Ray", last_name: "Holt", phone: "555-0199", role: "instructor" },
    });

    expect((await getTeamBookingByShareToken(supabase, TOKEN))?.cancellationPhone).toBe("555-0199");
  });

  test("falls back to the main line for manager-created bookings", async () => {
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: [],
      invoices: [],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: "555-0100", role: "manager" },
    });

    expect((await getTeamBookingByShareToken(supabase, TOKEN))?.cancellationPhone).toBe(
      MAIN_CANCELLATION_PHONE
    );
  });

  test("falls back to the main line when an instructor has no phone on file", async () => {
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: [],
      invoices: [],
      profiles: { first_name: "Ray", last_name: "Holt", phone: null, role: "instructor" },
    });

    expect((await getTeamBookingByShareToken(supabase, TOKEN))?.cancellationPhone).toBe(
      MAIN_CANCELLATION_PHONE
    );
  });

  test("reports a zero price for company-paid bookings", async () => {
    const supabase = mockSupabase({
      team_bookings: teamRow({ payment_mode: "company", price_per_seat: null, total_price: "1200.00" }),
      bookings: [],
      invoices: [],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: null, role: "manager" },
    });

    const view = await getTeamBookingByShareToken(supabase, TOKEN);
    expect(view?.paymentMode).toBe("company");
    expect(view?.pricePerSeat).toBe(0);
  });

  test("disambiguates the bookings→profiles embed with an explicit FK hint", async () => {
    // Regression guard. bookings has THREE foreign keys to profiles
    // (customer_id, created_by, cancelled_by), so a bare `profiles(...)` embed
    // is ambiguous and PostgREST rejects the entire query. That shipped once:
    // the attendee list silently rendered empty and spotsRemaining was
    // overstated, because the failed query returned null rather than throwing.
    // A mocked client cannot reproduce PostgREST's parser, so assert the query
    // shape directly.
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: [bookingRow("Jane", "Smith", "j@x.example")],
      invoices: [],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: null, role: "manager" },
    });

    await getTeamBookingByShareToken(supabase, TOKEN);

    const bookingSelects = selectsByTable.get("bookings") ?? [];
    expect(bookingSelects).toHaveLength(1);
    expect(bookingSelects[0]).toContain("profiles!bookings_customer_id_fkey");
    // A bare embed must never creep back in.
    expect(bookingSelects[0]).not.toMatch(/(^|[\s,(])profiles\s*\(/);
  });

  test("returns null rather than overstating free seats when the attendee query fails", async () => {
    // Failing open here would tell a company the class is wide open when it is
    // actually full, and let book_spot reject people at the last moment.
    const supabase = mockSupabase(
      {
        team_bookings: teamRow(),
        bookings: null,
        invoices: [],
        profiles: { first_name: "Ada", last_name: "Lovelace", phone: null, role: "manager" },
      },
      { bookings: { message: "could not embed" } }
    );

    expect(await getTeamBookingByShareToken(supabase, TOKEN)).toBeNull();
  });

  test("parses a string per-seat price into a number", async () => {
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: [],
      invoices: [],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: null, role: "manager" },
    });

    expect((await getTeamBookingByShareToken(supabase, TOKEN))?.pricePerSeat).toBe(80);
  });
});
