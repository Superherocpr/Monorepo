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
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateTeamPricing,
  generateShareToken,
  getTeamBookingByShareToken,
  ensureTeamInvoice,
  notifyTeamClassUpdated,
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

  // ── company_per_signup ────────────────────────────────────────────────────
  // The company is billed rate x headcount, so the RATE is required up front and
  // the total must not be: it is computed at invoice time from actual signups.

  test("accepts a per-signup booking carrying only a rate", () => {
    expect(
      validateTeamPricing(
        details({ paymentMode: "company_per_signup", pricePerSeat: 80, totalPrice: null })
      )
    ).toBeNull();
  });

  test("rejects a per-signup booking with no rate", () => {
    expect(
      validateTeamPricing(
        details({ paymentMode: "company_per_signup", pricePerSeat: null, totalPrice: null })
      )
    ).toMatch(/rate per signup is required/i);
  });

  test("rejects a zero per-signup rate, which would bill nothing at any headcount", () => {
    expect(
      validateTeamPricing(
        details({ paymentMode: "company_per_signup", pricePerSeat: 0, totalPrice: null })
      )
    ).toMatch(/greater than zero/i);
  });

  test("rejects a per-signup booking that also carries a total up front", () => {
    expect(
      validateTeamPricing(
        details({ paymentMode: "company_per_signup", pricePerSeat: 80, totalPrice: 1200 })
      )
    ).toMatch(/calculated at invoice time/i);
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
  errors: Record<string, unknown> = {},
  /**
   * Tables whose conditional UPDATE ... .is(col, null) claims zero rows, i.e. a
   * lost race against a concurrent writer. Reads on them are unaffected.
   */
  claimsNothing: string[] = [],
  /**
   * Row counts returned for head:true count queries, keyed by table. Used by
   * countTeamSignups, which asks for the headcount rather than the rows.
   */
  counts: Record<string, number> = {}
) {
  selectsByTable.clear();
  const from = vi.fn((table: string) => {
    const result = { data: tables[table] ?? null, error: errors[table] ?? null };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    // An UPDATE ... .select() returns the rows it actually changed, which is how
    // the caller detects a claim that lost its race — so once update() has been
    // called, the chain resolves to an array, not to the seeded read row.
    let isUpdate = false;
    // Set by a `.select(cols, { count: "exact", head: true })` call, which asks
    // for a row count instead of rows and so resolves to a different shape.
    let isCount = false;
    chain.select = vi.fn((cols?: string, options?: { head?: boolean }) => {
      if (typeof cols === "string") {
        selectsByTable.set(table, [...(selectsByTable.get(table) ?? []), cols]);
      }
      if (options?.head) isCount = true;
      return chain;
    });
    chain.update = vi.fn(() => {
      isUpdate = true;
      return chain;
    });
    for (const method of ["eq", "not", "order", "in", "is", "neq", "lt"]) {
      chain[method] = vi.fn(self);
    }
    chain.maybeSingle = vi.fn(() => Promise.resolve(result));
    chain.single = vi.fn(() => Promise.resolve(result));
    // Awaiting the chain directly (list queries) resolves to the same result;
    // an update resolves to the rows it claimed instead.
    chain.then = (resolve: (v: unknown) => unknown) => {
      if (isCount) {
        return resolve({
          count: counts[table] ?? 0,
          error: errors[table] ?? null,
          data: null,
        });
      }
      if (!isUpdate) return resolve(result);
      const claimed = claimsNothing.includes(table) ? [] : [{ id: TEAM_ID }];
      return resolve({ data: errors[table] ? null : claimed, error: errors[table] ?? null });
    };
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

  // The company calls whoever is teaching their class, not the office. These
  // pin that precedence: assigned instructor, then an instructor who created the
  // booking, then the main line.

  test("uses the assigned instructor's phone", async () => {
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: [],
      invoices: [],
      profiles: { first_name: "Ray", last_name: "Holt", phone: "555-0199", role: "instructor" },
    });

    expect((await getTeamBookingByShareToken(supabase, TOKEN))?.cancellationPhone).toBe("555-0199");
  });

  test("uses the assigned instructor's phone even on a manager-created booking", async () => {
    // The manager arranged it, but the instructor is who can answer about the
    // day itself, so their number is the one the company sees.
    const supabase = mockSupabase({
      team_bookings: teamRow(),
      bookings: [],
      invoices: [],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: "555-0100", role: "manager" },
    });

    expect((await getTeamBookingByShareToken(supabase, TOKEN))?.cancellationPhone).toBe("555-0100");
  });

  test("falls back to the main line when the class has no instructor assigned", async () => {
    const base = teamRow();
    const supabase = mockSupabase({
      team_bookings: {
        ...base,
        class_sessions: { ...(base.class_sessions as object), instructor_id: null },
      },
      bookings: [],
      invoices: [],
      profiles: { first_name: "Ada", last_name: "Lovelace", phone: null, role: "manager" },
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

// ---------------------------------------------------------------------------
// ensureTeamInvoice
// ---------------------------------------------------------------------------

/**
 * These guard the one thing that must never happen while recovering an invoice:
 * billing a company twice. ensureTeamInvoice() is reachable from an admin button
 * AND a nightly cron sweep, so it can be entered concurrently for the same
 * booking — every short-circuit below is what keeps that safe.
 *
 * createAndSendInvoice is mocked, so a test that reached PayPal would fail loudly
 * on the assertion that it was never called.
 */
const createAndSendInvoiceMock = vi.fn();
vi.mock("@/lib/invoice-actions", () => ({
  createAndSendInvoice: (...args: unknown[]) => createAndSendInvoiceMock(...args),
}));

/**
 * Real send-email module state, defaulting to "not configured" so it stays
 * a no-op in describe blocks that never touch it. notifyTeamClassUpdated's
 * tests flip emailConfigured to exercise the actual send path, then restore it.
 */
const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
let emailConfigured = false;
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  isEmailConfigured: () => emailConfigured,
}));

/** A company-mode team_bookings row as ensureTeamInvoice() reads it. */
function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEAM_ID,
    session_id: SESSION_ID,
    company_name: "Bradenton Bay High School",
    contact_name: "Stephanie Booker",
    contact_email: "contact@school.example",
    contact_phone: "941-555-0100",
    payment_mode: "company",
    total_price: "1020.00",
    invoice_id: null,
    ...overrides,
  };
}

describe("ensureTeamInvoice", () => {
  beforeEach(() => {
    createAndSendInvoiceMock.mockReset();
  });

  test("refuses to raise a second invoice when one is already linked", async () => {
    const supabase = mockSupabase({
      team_bookings: companyRow({ invoice_id: "already-there" }),
    });

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    expect(result).toEqual({ status: "already_linked", invoiceId: "already-there" });
    // The money path must not have been entered at all.
    expect(createAndSendInvoiceMock).not.toHaveBeenCalled();
  });

  test("does nothing for a per-seat booking, where a null invoice is correct", async () => {
    const supabase = mockSupabase({
      team_bookings: companyRow({ payment_mode: "per_seat", total_price: null }),
    });

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    expect(result.status).toBe("not_applicable");
    expect(createAndSendInvoiceMock).not.toHaveBeenCalled();
  });

  test("does nothing for a missing booking", async () => {
    const supabase = mockSupabase({ team_bookings: null });

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    expect(result.status).toBe("not_applicable");
    expect(createAndSendInvoiceMock).not.toHaveBeenCalled();
  });

  test("treats a company booking with no total as corrupt, not as retryable", async () => {
    const supabase = mockSupabase({ team_bookings: companyRow({ total_price: null }) });

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    // "failed" would put it back in the retry queue forever; it can never succeed.
    expect(result.status).toBe("not_applicable");
    expect(createAndSendInvoiceMock).not.toHaveBeenCalled();
  });

  test("reports a PayPal failure as retryable", async () => {
    createAndSendInvoiceMock.mockResolvedValue({ success: false, error: "PayPal is down." });

    const supabase = mockSupabase({
      team_bookings: companyRow(),
      class_sessions: {
        starts_at: "2026-09-09T10:30:00",
        instructor_id: INSTRUCTOR_ID,
        class_types: { name: "BLS Renewals" },
        locations: { name: "Bradenton Bay", city: "Bradenton", state: "FL" },
      },
      profiles: { first_name: "Ada", last_name: "Lovelace" },
    });

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    expect(result).toEqual({ status: "failed", error: "PayPal is down." });
  });

  test("reports a lost race as unlinked, never as a clean success", async () => {
    // Another caller (the nightly sweep, or a second click) linked an invoice
    // between our null check and our write. A second invoice really was raised
    // on PayPal, so this must reach a human and must never be retried.
    createAndSendInvoiceMock.mockResolvedValue({
      success: true,
      invoiceId: "inv-duplicate",
      invoiceNumber: "INV-00002",
    });

    const supabase = mockSupabase(
      {
        team_bookings: companyRow(),
        class_sessions: {
          starts_at: "2026-09-09T10:30:00",
          instructor_id: INSTRUCTOR_ID,
          class_types: { name: "BLS Renewals" },
          locations: { name: "Bradenton Bay", city: "Bradenton", state: "FL" },
        },
        profiles: { first_name: "Ada", last_name: "Lovelace" },
      },
      {},
      ["team_bookings"]
    );

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    expect(result.status).toBe("created_unlinked");
  });

  test("bills the flat total, with zero students so no seats are consumed", async () => {
    createAndSendInvoiceMock.mockResolvedValue({
      success: true,
      invoiceId: "inv-1",
      invoiceNumber: "INV-00001",
    });

    const supabase = mockSupabase({
      team_bookings: companyRow(),
      class_sessions: {
        starts_at: "2026-09-09T10:30:00",
        instructor_id: INSTRUCTOR_ID,
        class_types: { name: "BLS Renewals" },
        locations: { name: "Bradenton Bay", city: "Bradenton", state: "FL" },
      },
      profiles: { first_name: "Ada", last_name: "Lovelace" },
    });

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    expect(result).toEqual({
      status: "created",
      invoiceId: "inv-1",
      invoiceNumber: "INV-00001",
    });

    const sent = createAndSendInvoiceMock.mock.calls[0][1] as Record<string, unknown>;
    // The numeric total must survive Postgres returning it as a string.
    expect(sent.totalAmount).toBe(1020);
    // student_count 0 is what stops a team invoice reserving class capacity.
    expect(sent.studentCount).toBe(0);
    expect(sent.primaryLineItem).toEqual({
      name: "Corporate Training — BLS Renewals",
      quantity: 1,
      unitAmount: 1020,
    });
  });

  // ── company_per_signup ────────────────────────────────────────────────────
  // The amount is not stored anywhere before billing: it is the live signup
  // count times the rate, so these tests pin the arithmetic and the guard that
  // stops a company being invoiced for a class nobody joined.

  /** A per-signup row: a rate, and no total until it is billed. */
  function perSignupRow(overrides: Record<string, unknown> = {}) {
    return companyRow({
      payment_mode: "company_per_signup",
      total_price: null,
      price_per_seat: "80.00",
      ...overrides,
    });
  }

  /** The session and profile rows the invoice path reads after the booking. */
  const invoiceContext = {
    class_sessions: {
      starts_at: "2026-09-09T10:30:00",
      instructor_id: INSTRUCTOR_ID,
      class_types: { name: "BLS Renewals" },
      locations: { name: "Acme HQ", city: "Tampa", state: "FL" },
    },
    profiles: { first_name: "Ada", last_name: "Lovelace" },
  };

  test("bills rate x signups, and records the computed total", async () => {
    createAndSendInvoiceMock.mockResolvedValue({
      success: true,
      invoiceId: "inv-2",
      invoiceNumber: "INV-00002",
    });

    const supabase = mockSupabase(
      { team_bookings: perSignupRow(), ...invoiceContext },
      {},
      [],
      { bookings: 7 }
    );

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    expect(result.status).toBe("created");

    const sent = createAndSendInvoiceMock.mock.calls[0][1] as Record<string, unknown>;
    expect(sent.totalAmount).toBe(560); // 7 signups x $80
    // Still zero: a team invoice must never reserve capacity, in either mode.
    expect(sent.studentCount).toBe(0);
    // The company gets a line it can check against its own headcount.
    expect(sent.primaryLineItem).toEqual({
      name: "Corporate Training — BLS Renewals (7 people at $80.00 each)",
      quantity: 1,
      unitAmount: 560,
    });
  });

  test("bills nothing, and reports it as ordinary, when nobody signed up", async () => {
    const supabase = mockSupabase(
      { team_bookings: perSignupRow(), ...invoiceContext },
      {},
      [],
      { bookings: 0 }
    );

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    // Distinct from not_applicable so the nightly sweep does not alert on it
    // every day for the rest of time.
    expect(result.status).toBe("nothing_to_bill");
    expect(createAndSendInvoiceMock).not.toHaveBeenCalled();
  });

  test("refuses a per-signup booking with no rate rather than billing zero", async () => {
    const supabase = mockSupabase(
      { team_bookings: perSignupRow({ price_per_seat: null }), ...invoiceContext },
      {},
      [],
      { bookings: 5 }
    );

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    expect(result.status).toBe("not_applicable");
    expect(createAndSendInvoiceMock).not.toHaveBeenCalled();
  });

  test("rounds to cents rather than sending a float artifact to PayPal", async () => {
    createAndSendInvoiceMock.mockResolvedValue({
      success: true,
      invoiceId: "inv-3",
      invoiceNumber: "INV-00003",
    });

    const supabase = mockSupabase(
      { team_bookings: perSignupRow({ price_per_seat: "10.10" }), ...invoiceContext },
      {},
      [],
      { bookings: 3 }
    );

    await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    // 10.10 * 3 is 30.299999999999997 in binary floating point.
    const sent = createAndSendInvoiceMock.mock.calls[0][1] as Record<string, unknown>;
    expect(sent.totalAmount).toBe(30.3);
  });

  test("uses the singular line for a single signup", async () => {
    createAndSendInvoiceMock.mockResolvedValue({
      success: true,
      invoiceId: "inv-4",
      invoiceNumber: "INV-00004",
    });

    const supabase = mockSupabase(
      { team_bookings: perSignupRow(), ...invoiceContext },
      {},
      [],
      { bookings: 1 }
    );

    await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    const sent = createAndSendInvoiceMock.mock.calls[0][1] as Record<string, unknown>;
    expect(sent.primaryLineItem).toMatchObject({
      name: "Corporate Training — BLS Renewals (1 person at $80.00 each)",
      unitAmount: 80,
    });
  });

  test("still refuses to raise a second invoice on a per-signup booking", async () => {
    const supabase = mockSupabase(
      { team_bookings: perSignupRow({ invoice_id: "already-there" }), ...invoiceContext },
      {},
      [],
      { bookings: 9 }
    );

    const result = await ensureTeamInvoice(supabase as never, {
      teamBookingId: TEAM_ID,
      actorId: CREATOR_ID,
    });

    expect(result).toEqual({ status: "already_linked", invoiceId: "already-there" });
    expect(createAndSendInvoiceMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// notifyTeamClassUpdated
// ---------------------------------------------------------------------------
// Team-booking classes can be edited (date/time/location/certification) at any
// time, with no re-approval step to catch anyone's attention. This function is
// what replaces that review for the one audience it actually matters to —
// these tests pin who gets emailed and who is safely skipped.

describe("notifyTeamClassUpdated", () => {
  const args = {
    sessionId: SESSION_ID,
    companyName: "Acme Hospital",
    classTypeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    locationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    startsAt: "2026-10-01T09:00:00",
  };

  beforeEach(() => {
    sendEmailMock.mockClear();
    emailConfigured = true;
  });

  afterEach(() => {
    // Restore the default other describe blocks in this file rely on.
    emailConfigured = false;
  });

  test("does nothing when Resend is not configured", async () => {
    emailConfigured = false;
    const supabase = mockSupabase({
      bookings: [{ profiles: { first_name: "Dana", email: "dana@example.com" } }],
      class_types: { name: "BLS Provider" },
      locations: { name: "Acme HQ" },
    });

    await notifyTeamClassUpdated(supabase as never, args);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("does nothing when nobody is currently signed up", async () => {
    const supabase = mockSupabase({
      bookings: [],
      class_types: { name: "BLS Provider" },
      locations: { name: "Acme HQ" },
    });

    await notifyTeamClassUpdated(supabase as never, args);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("emails every active attendee with the new class details", async () => {
    const supabase = mockSupabase({
      bookings: [
        { profiles: { first_name: "Dana", email: "dana@example.com" } },
        { profiles: { first_name: "Ray", email: "ray@example.com" } },
      ],
      class_types: { name: "ACLS Provider" },
      locations: {
        name: "Acme HQ",
        address: "1 Main St",
        city: "Tampa",
        state: "FL",
        zip: "33602",
      },
    });

    await notifyTeamClassUpdated(supabase as never, args);

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = sendEmailMock.mock.calls.map((c) => c[0]);
    expect(firstCall).toMatchObject({
      context: "team-bookings:class-updated",
      to: "dana@example.com",
    });
    expect(secondCall).toMatchObject({ to: "ray@example.com" });
    // The new certification name must actually reach the email, not the old one.
    expect(firstCall.subject).toMatch(/ACLS Provider/);
    expect(firstCall.html).toContain("Acme Hospital");
    expect(firstCall.html).toContain("1 Main St");
  });

  test("skips an attendee with no email on file, but still alerts admins about the miss", async () => {
    // Nobody automatically retries a missed notification, so a person with no
    // address on file must surface just as loudly as a rejected send.
    const supabase = mockSupabase({
      bookings: [
        { profiles: { first_name: "Dana", email: null } },
        { profiles: { first_name: "Ray", email: "ray@example.com" } },
      ],
      class_types: { name: "BLS Provider" },
      locations: { name: "Acme HQ" },
      profiles: [{ email: "admin@example.com" }],
    });

    await notifyTeamClassUpdated(supabase as never, args);

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const [rayCall, alertCall] = sendEmailMock.mock.calls.map((c) => c[0]);
    expect(rayCall.to).toBe("ray@example.com");
    expect(alertCall).toMatchObject({
      context: "team-bookings:class-updated-failed",
      to: ["admin@example.com"],
    });
    expect(alertCall.html).toContain("Dana");
    expect(alertCall.html).toContain("No email address on file");
  });

  test("alerts admins when Resend rejects a notification", async () => {
    sendEmailMock
      .mockResolvedValueOnce({ sent: true, id: "e1" }) // Dana: succeeds
      .mockResolvedValueOnce({ sent: false, reason: "failed", error: "Resend rejected the message" }); // Ray: fails

    const supabase = mockSupabase({
      bookings: [
        { profiles: { first_name: "Dana", email: "dana@example.com" } },
        { profiles: { first_name: "Ray", email: "ray@example.com" } },
      ],
      class_types: { name: "ACLS Provider" },
      locations: { name: "Acme HQ" },
      profiles: [{ email: "admin@example.com" }],
    });

    await notifyTeamClassUpdated(supabase as never, args);

    // Dana's send, Ray's failed send, and the resulting admin alert.
    expect(sendEmailMock).toHaveBeenCalledTimes(3);
    const alertCall = sendEmailMock.mock.calls[2][0];
    expect(alertCall.context).toBe("team-bookings:class-updated-failed");
    expect(alertCall.subject).toMatch(/1 person/);
    expect(alertCall.html).toContain("Ray");
    expect(alertCall.html).toContain("Resend rejected the message");
    // Dana succeeded and must not appear as a miss.
    expect(alertCall.html).not.toContain("Dana");
  });

  test("logs but does not throw when there are no super_admin recipients to alert", async () => {
    sendEmailMock.mockResolvedValueOnce({ sent: false, reason: "failed", error: "boom" });

    const supabase = mockSupabase({
      bookings: [{ profiles: { first_name: "Dana", email: "dana@example.com" } }],
      class_types: { name: "BLS Provider" },
      locations: { name: "Acme HQ" },
      // No `profiles` rows configured: the admin lookup comes back empty.
    });

    await expect(notifyTeamClassUpdated(supabase as never, args)).resolves.toBeUndefined();
    // Only the failed attendee send: notifyTeamClassUpdateFailed bails out
    // before calling sendEmail again when there is nobody to alert.
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  test("never throws, even if the lookup itself fails", async () => {
    const supabase = mockSupabase({}, { bookings: { message: "boom" } });

    await expect(notifyTeamClassUpdated(supabase as never, args)).resolves.toBeUndefined();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
