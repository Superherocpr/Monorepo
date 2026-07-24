/**
 * Unit tests for lib/addon-checkout.ts (listSessionAddons, resolveAddonsSelection)
 *
 * This is the source of truth the order-creation and capture routes rely on
 * to price add-ons server-side — a client-submitted add-on id must never be
 * trusted without being re-checked against session_addons here.
 * The Supabase client is mocked; no real DB access.
 */
import { describe, test, expect, vi } from "vitest";
import { listSessionAddons, resolveAddonsSelection } from "@/lib/addon-checkout";

const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const ADDON_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ADDON_B = "aaaaaaaa-0000-0000-0000-000000000002";
const ADDON_INACTIVE = "aaaaaaaa-0000-0000-0000-000000000003";

/** A thenable chain resolving `.eq(...)` awaits directly to `result` (no .single()/.maybeSingle() in this module). */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.eq = vi.fn(() => Promise.resolve(result));
  return c;
}

function mockSupabase(sessionAddonsResult: { data: unknown; error: unknown }) {
  const from = vi.fn((table: string) => {
    if (table !== "session_addons") throw new Error(`Unexpected .from("${table}") call in test`);
    return chain(sessionAddonsResult);
  });
  return { from } as unknown as Parameters<typeof listSessionAddons>[0];
}

const row = (addon: { id: string; name: string; price: number | string; active: boolean } | null) => ({
  addons: addon,
});

describe("listSessionAddons", () => {
  test("returns active add-ons with numeric prices parsed from strings", async () => {
    const supabase = mockSupabase({
      data: [
        row({ id: ADDON_A, name: "Extra Manikin", price: "25.00", active: true }),
        row({ id: ADDON_B, name: "Card Rush", price: 15, active: true }),
      ],
      error: null,
    });
    const result = await listSessionAddons(supabase, SESSION_ID);
    expect(result).toEqual([
      { id: ADDON_A, name: "Extra Manikin", price: 25 },
      { id: ADDON_B, name: "Card Rush", price: 15 },
    ]);
  });

  test("filters out inactive add-ons even if opted into the session", async () => {
    const supabase = mockSupabase({
      data: [
        row({ id: ADDON_A, name: "Extra Manikin", price: 25, active: true }),
        row({ id: ADDON_INACTIVE, name: "Discontinued Kit", price: 10, active: false }),
      ],
      error: null,
    });
    const result = await listSessionAddons(supabase, SESSION_ID);
    expect(result.map((a) => a.id)).toEqual([ADDON_A]);
  });

  test("filters out null joins (orphaned session_addons row)", async () => {
    const supabase = mockSupabase({ data: [row(null)], error: null });
    const result = await listSessionAddons(supabase, SESSION_ID);
    expect(result).toEqual([]);
  });

  test("returns an empty list (not a throw) on a DB error", async () => {
    const supabase = mockSupabase({ data: null, error: { message: "timeout" } });
    const result = await listSessionAddons(supabase, SESSION_ID);
    expect(result).toEqual([]);
  });
});

describe("resolveAddonsSelection", () => {
  test("returns valid with zero total when no add-ons are requested", async () => {
    const supabase = mockSupabase({ data: [], error: null });
    const result = await resolveAddonsSelection(supabase, SESSION_ID, []);
    expect(result).toEqual({ valid: true, addons: [], total: 0 });
  });

  test("resolves all requested add-ons and sums an authoritative total", async () => {
    const supabase = mockSupabase({
      data: [
        row({ id: ADDON_A, name: "Extra Manikin", price: 25, active: true }),
        row({ id: ADDON_B, name: "Card Rush", price: 15, active: true }),
      ],
      error: null,
    });
    const result = await resolveAddonsSelection(supabase, SESSION_ID, [ADDON_A, ADDON_B]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.total).toBe(40);
      expect(result.addons).toHaveLength(2);
    }
  });

  test("rejects the whole selection if any requested add-on isn't opted into the session", async () => {
    const supabase = mockSupabase({
      data: [row({ id: ADDON_A, name: "Extra Manikin", price: 25, active: true })],
      error: null,
    });
    // Client asks for ADDON_B too, which this session never opted into.
    const result = await resolveAddonsSelection(supabase, SESSION_ID, [ADDON_A, ADDON_B]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/no longer available/i);
  });

  test("rejects a selection referencing an inactive add-on (present in session_addons but active=false)", async () => {
    const supabase = mockSupabase({
      data: [row({ id: ADDON_INACTIVE, name: "Discontinued Kit", price: 10, active: false })],
      error: null,
    });
    const result = await resolveAddonsSelection(supabase, SESSION_ID, [ADDON_INACTIVE]);
    expect(result.valid).toBe(false);
  });

  test("dedupes repeated add-on ids in the request instead of double-charging", async () => {
    const supabase = mockSupabase({
      data: [row({ id: ADDON_A, name: "Extra Manikin", price: 25, active: true })],
      error: null,
    });
    const result = await resolveAddonsSelection(supabase, SESSION_ID, [ADDON_A, ADDON_A, ADDON_A]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.addons).toHaveLength(1);
      expect(result.total).toBe(25);
    }
  });

  test("rounds a summed total to two decimal places", async () => {
    const supabase = mockSupabase({
      data: [
        row({ id: ADDON_A, name: "A", price: 10.1, active: true }),
        row({ id: ADDON_B, name: "B", price: 20.2, active: true }),
      ],
      error: null,
    });
    const result = await resolveAddonsSelection(supabase, SESSION_ID, [ADDON_A, ADDON_B]);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.total).toBe(30.3);
  });
});
