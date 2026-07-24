/**
 * Unit tests for lib/promo-codes.ts (resolvePromoDiscount)
 *
 * This is the single source of truth both order-creation and capture routes
 * rely on to compute the authoritative discounted price server-side — bugs
 * here directly translate into wrong amounts being charged or accepted.
 * The Supabase client is mocked; no real DB access.
 */
import { describe, test, expect, vi } from "vitest";
import { resolvePromoDiscount } from "@/lib/promo-codes";

const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_SESSION_ID = "44444444-4444-4444-4444-444444444444";
const PROMO_ID = "55555555-5555-5555-5555-555555555555";
const CLASS_TYPE_ID = "66666666-6666-6666-6666-666666666666";
const OTHER_CLASS_TYPE_ID = "77777777-7777-7777-7777-777777777777";

/** A minimal chainable query builder resolving to `result` on .maybeSingle(). */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.eq = vi.fn(self);
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  return c;
}

/** Builds a fake Supabase client that routes `.from(table)` to a fixed response per table. */
function mockSupabase(responses: Record<string, { data: unknown; error: unknown }>) {
  const from = vi.fn((table: string) => {
    const result = responses[table];
    if (!result) throw new Error(`Unexpected .from("${table}") call in test`);
    return chain(result);
  });
  return { from } as unknown as Parameters<typeof resolvePromoDiscount>[0];
}

const basePromoRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: PROMO_ID,
  code: "SAVE10",
  discount_type: "fixed" as const,
  discount_value: 10,
  expires_at: null,
  active: true,
  scope: "all" as const,
  ...overrides,
});

describe("resolvePromoDiscount", () => {
  test("rejects an unknown code", async () => {
    const supabase = mockSupabase({ promo_codes: { data: null, error: null } });
    const result = await resolvePromoDiscount(supabase, "NOPE", SESSION_ID, 100);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/invalid promo code/i);
  });

  test("rejects an inactive code", async () => {
    const supabase = mockSupabase({
      promo_codes: { data: basePromoRow({ active: false }), error: null },
    });
    const result = await resolvePromoDiscount(supabase, "save10", SESSION_ID, 100);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/no longer active/i);
  });

  test("rejects an expired code", async () => {
    const supabase = mockSupabase({
      promo_codes: {
        data: basePromoRow({ expires_at: new Date(Date.now() - 86_400_000).toISOString() }),
        error: null,
      },
    });
    const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/expired/i);
  });

  test("accepts a code expiring in the future", async () => {
    const supabase = mockSupabase({
      promo_codes: {
        data: basePromoRow({ expires_at: new Date(Date.now() + 86_400_000).toISOString() }),
        error: null,
      },
    });
    const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
    expect(result.valid).toBe(true);
  });

  test("propagates a DB lookup failure as a generic error (no internals leaked)", async () => {
    const supabase = mockSupabase({
      promo_codes: { data: null, error: { message: "connection reset" } },
    });
    const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).not.toMatch(/connection reset/i);
      expect(result.error).toMatch(/failed to validate/i);
    }
  });

  test("normalizes the code (trims and uppercases) before lookup", async () => {
    const fromSpy = vi.fn((table: string) => {
      if (table === "promo_codes") return chain({ data: basePromoRow(), error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const supabase = { from: fromSpy } as unknown as Parameters<typeof resolvePromoDiscount>[0];

    await resolvePromoDiscount(supabase, "  save10  ", SESSION_ID, 100);

    const chainResult = fromSpy.mock.results[0].value as { eq: ReturnType<typeof vi.fn> };
    expect(chainResult.eq).toHaveBeenCalledWith("code", "SAVE10");
  });

  describe("discount math", () => {
    test("fixed discount subtracts a flat amount", async () => {
      const supabase = mockSupabase({
        promo_codes: { data: basePromoRow({ discount_type: "fixed", discount_value: 10 }), error: null },
      });
      const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.discountAmount).toBe(10);
        expect(result.finalPrice).toBe(90);
      }
    });

    test("percent discount computes and rounds to the cent", async () => {
      // $33 base at 15% = $4.95 discount, $28.05 final — must not drift via float error.
      const supabase = mockSupabase({
        promo_codes: { data: basePromoRow({ discount_type: "percent", discount_value: 15 }), error: null },
      });
      const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 33);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.discountAmount).toBe(4.95);
        expect(result.finalPrice).toBe(28.05);
      }
    });

    test("free discount type zeroes the price regardless of discount_value", async () => {
      const supabase = mockSupabase({
        promo_codes: { data: basePromoRow({ discount_type: "free", discount_value: 0 }), error: null },
      });
      const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 149.99);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.discountAmount).toBe(149.99);
        expect(result.finalPrice).toBe(0);
      }
    });

    test("rejects a fixed discount that exceeds the base price (over-discount guard)", async () => {
      const supabase = mockSupabase({
        promo_codes: { data: basePromoRow({ discount_type: "fixed", discount_value: 200 }), error: null },
      });
      const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toMatch(/exceeds the session price/i);
    });

    test("allows a fixed discount exactly equal to the base price (free via 'fixed')", async () => {
      const supabase = mockSupabase({
        promo_codes: { data: basePromoRow({ discount_type: "fixed", discount_value: 100 }), error: null },
      });
      const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.finalPrice).toBe(0);
    });

    test("discount_value stored as a numeric string is parsed correctly", async () => {
      const supabase = mockSupabase({
        promo_codes: { data: basePromoRow({ discount_type: "fixed", discount_value: "25" }), error: null },
      });
      const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.finalPrice).toBe(75);
    });
  });

  describe("scope enforcement", () => {
    test("scope=all applies with no junction table lookup", async () => {
      const fromSpy = vi.fn((table: string) => {
        if (table === "promo_codes") return chain({ data: basePromoRow({ scope: "all" }), error: null });
        throw new Error(`unexpected junction lookup for scope=all: ${table}`);
      });
      const supabase = { from: fromSpy } as unknown as Parameters<typeof resolvePromoDiscount>[0];
      const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
      expect(result.valid).toBe(true);
    });

    test("scope=session_type accepts a session whose class type is linked", async () => {
      const supabase = mockSupabase({
        promo_codes: { data: basePromoRow({ scope: "session_type" }), error: null },
        class_sessions: { data: { class_type_id: CLASS_TYPE_ID }, error: null },
        promo_code_class_types: { data: { id: "link-1" }, error: null },
      });
      const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
      expect(result.valid).toBe(true);
    });

    test("scope=session_type rejects a session whose class type is not linked", async () => {
      const supabase = mockSupabase({
        promo_codes: { data: basePromoRow({ scope: "session_type" }), error: null },
        class_sessions: { data: { class_type_id: OTHER_CLASS_TYPE_ID }, error: null },
        promo_code_class_types: { data: null, error: null },
      });
      const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toMatch(/not valid for this session type/i);
    });

    test("scope=session accepts a session directly linked via promo_code_sessions", async () => {
      const supabase = mockSupabase({
        promo_codes: { data: basePromoRow({ scope: "session" }), error: null },
        promo_code_sessions: { data: { id: "link-1" }, error: null },
      });
      const result = await resolvePromoDiscount(supabase, "SAVE10", SESSION_ID, 100);
      expect(result.valid).toBe(true);
    });

    test("scope=session rejects a session that isn't the linked one", async () => {
      const supabase = mockSupabase({
        promo_codes: { data: basePromoRow({ scope: "session" }), error: null },
        promo_code_sessions: { data: null, error: null },
      });
      const result = await resolvePromoDiscount(supabase, "SAVE10", OTHER_SESSION_ID, 100);
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toMatch(/not valid for this session/i);
    });
  });
});
