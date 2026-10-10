/**
 * Manager / instructor parity for class-day tools.
 *
 * Managers teach classes too and must be able to do everything an instructor
 * can on their own class. These tests drive real route handlers:
 *   PATCH /api/sessions/[id]/grade  — the representative instructor tool: a
 *     manager grades their own class, is refused on another instructor's class,
 *     and the route's role allowlist includes managers.
 *   POST /api/rollcall/verify-code  — a manager's rollcall code must be found
 *     (it was previously filtered out, so students of a manager-taught class
 *     were told the code was wrong).
 *
 * The source scan in tests/unit/lib/role-groups.test.ts covers the remaining
 * routes' allowlists statically.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server     — prevents Next.js cookies() runtime requirement
 *   @/lib/auth/effective-role — session auth resolution
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { PATCH as gradePatch } from "@/app/api/sessions/[id]/grade/route";
import { POST as verifyCodePost } from "@/app/api/rollcall/verify-code/route";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/effective-role", () => ({
  requireApiRole: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const MANAGER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_INSTRUCTOR_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const ROSTER_ID = "44444444-4444-4444-4444-444444444444";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
  const self = () => c;
  for (const m of ["select", "update", "eq", "neq", "in", "gte", "lte", "order"]) {
    c[m] = vi.fn(self);
  }
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.single = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c as Record<string, ReturnType<typeof vi.fn>>;
}

/** Hands back the given chains from admin.from() in call order. */
function mockFromSequence(chains: ReturnType<typeof chain>[]) {
  const from = vi.fn();
  chains.forEach((c) => from.mockReturnValueOnce(c));
  from.mockReturnValue(chain({ data: null, error: null }));
  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from });
  return from;
}

function mockManagerActor() {
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: {
      user: { id: MANAGER_ID },
      profile: { first_name: "Morgan", last_name: "Manager" },
      effectiveRole: "manager",
    },
  });
}

function gradeRequest(): Request {
  return new Request(`https://superherocpr.com/api/sessions/${SESSION_ID}/grade`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roster_record_id: ROSTER_ID, grade: 1 }),
  });
}

const params = { params: Promise.resolve({ id: SESSION_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/sessions/[id]/grade as a manager", () => {
  test("the route's role allowlist admits managers", async () => {
    mockManagerActor();
    mockFromSequence([chain({ data: null, error: null })]);
    await gradePatch(gradeRequest(), params);
    const allowed = (requireApiRole as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(allowed).toContain("manager");
  });

  test("grades a student in a class the manager teaches", async () => {
    mockManagerActor();
    const update = chain({ data: null, error: null });
    mockFromSequence([
      chain({ data: { id: SESSION_ID, instructor_id: MANAGER_ID }, error: null }),
      chain({ data: { id: ROSTER_ID }, error: null }),
      update,
    ]);

    const res = await gradePatch(gradeRequest(), params);

    expect(res.status).toBe(200);
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ grade: 1 }));
  });

  test("is refused on another instructor's class and writes nothing", async () => {
    mockManagerActor();
    const from = mockFromSequence([
      chain({ data: { id: SESSION_ID, instructor_id: OTHER_INSTRUCTOR_ID }, error: null }),
    ]);

    const res = await gradePatch(gradeRequest(), params);

    expect(res.status).toBe(403);
    // Only the session lookup ran: no roster lookup, no update.
    expect(from).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/rollcall/verify-code with a manager's code", () => {
  test("looks the code up across every teaching role, managers included", async () => {
    const profileLookup = chain({
      data: {
        id: MANAGER_ID,
        first_name: "Morgan",
        last_name: "Manager",
        access_code_generated_at: new Date().toISOString(),
      },
      error: null,
    });
    mockFromSequence([profileLookup, chain({ data: [], error: null })]);

    const res = await verifyCodePost(
      new Request("https://superherocpr.com/api/rollcall/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
        body: JSON.stringify({ code: "123456" }),
      })
    );
    const body = (await res.json()) as { valid: boolean; instructorId?: string };

    const roleFilter = profileLookup.in.mock.calls.find((call) => call[0] === "role");
    expect(roleFilter?.[1]).toContain("manager");
    expect(body.valid).toBe(true);
    expect(body.instructorId).toBe(MANAGER_ID);
  });
});
