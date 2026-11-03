/**
 * /book must never crash because a class has no instructor.
 *
 * On 2026-11-03 a scheduled, approved, public class with instructor_id = null
 * took the whole page down with a 500 on staging: the session list reads
 * profiles.first_name on every row. A class with no instructor also cannot be
 * booked safely (the payment would be taken and the instructor's earning could
 * not be recorded), so it is kept off the page rather than shown.
 *
 * Two layers are pinned here: the query excludes instructor-less classes, and
 * even if one slips through (the join comes back null) the page drops it
 * instead of throwing.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/app/(public)/book/_components/BookSessionSelector", () => ({ default: () => null }));

import { createAdminClient } from "@/lib/supabase/server";
import BookPage from "@/app/(public)/book/page";

const notCalls: unknown[][] = [];

/** One raw session row as PostgREST returns it, with an overridable instructor join. */
function rawSession(id: string, profiles: unknown) {
  return {
    id,
    starts_at: "2026-12-01T10:00:00",
    ends_at: "2026-12-01T14:00:00",
    max_capacity: 6,
    status: "scheduled",
    discount_percent: null,
    class_types: { id: "ct-1", name: "BLS", price: 80, duration_minutes: 240, is_aha: true },
    profiles,
    locations: { name: "Hall", address: "1 Main", city: "Tampa", state: "FL", zip: "33601" },
    bookings: [],
    invoices: [],
  };
}

/** A chainable, awaitable query stub that resolves to `data` and records .not() calls. */
function stubDb(sessionRows: unknown[]): void {
  const make = (data: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "order"]) c[m] = vi.fn(() => c);
    c.not = vi.fn((...args: unknown[]) => {
      notCalls.push(args);
      return c;
    });
    c.then = (resolve: (v: { data: unknown }) => unknown) => Promise.resolve({ data }).then(resolve);
    return c;
  };
  vi.mocked(createAdminClient).mockResolvedValue({
    from: (table: string) =>
      table === "class_sessions" ? make(sessionRows) : make([{ id: "ct-1", name: "BLS" }]),
  } as never);
}

async function render(): Promise<{ sessions: Array<{ id: string }> }> {
  const element = (await BookPage({ searchParams: Promise.resolve({}) })) as { props: { sessions: Array<{ id: string }> } };
  return element.props;
}

const instructor = { first_name: "Alex", last_name: "Hero", email: "a@x.test", phone: "555" };

beforeEach(() => {
  vi.clearAllMocks();
  notCalls.length = 0;
});

describe("/book without an instructor", () => {
  test("asks the database to exclude classes with no instructor", async () => {
    stubDb([rawSession("s1", instructor)]);
    await render();
    expect(notCalls).toContainEqual(["instructor_id", "is", null]);
  });

  test("a row that still comes back with no instructor is dropped, not a crash", async () => {
    stubDb([rawSession("s1", instructor), rawSession("s2", null)]);
    const { sessions } = await render();
    expect(sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  test("an empty instructor join array is also dropped", async () => {
    stubDb([rawSession("s1", [])]);
    const { sessions } = await render();
    expect(sessions).toEqual([]);
  });

  test("normal classes with an instructor are unaffected", async () => {
    stubDb([rawSession("s1", instructor), rawSession("s2", [instructor])]);
    const { sessions } = await render();
    expect(sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});
