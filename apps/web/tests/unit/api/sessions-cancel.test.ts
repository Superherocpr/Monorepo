/**
 * Unit tests for POST /api/sessions/[id]/cancel (app/api/sessions/[id]/cancel/route.ts)
 *
 * Tests the 48-hour instructor cancellation window, ownership checks, the
 * manager/super_admin bypass of that window, and the already-cancelled guard.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server     — prevents Next.js cookies() runtime requirement
 *   @/lib/auth/effective-role — session auth resolution
 *   resend                    — prevents real email sends
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/sessions/[id]/cancel/route";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/effective-role", () => ({
  requireApiRole: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function Resend() {
    return {
      emails: {
        send: vi.fn().mockResolvedValue({ data: { id: "email-id" }, error: null }),
      },
    };
  }),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const INSTRUCTOR_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_INSTRUCTOR_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.update = vi.fn(self);
  c.eq = vi.fn(self);
  c.in = vi.fn(self);
  c.single = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

function makeRequest(reason = "The instructor is unavailable that day."): Request {
  return new Request(`https://superherocpr.com/api/sessions/${SESSION_ID}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

function params() {
  return { params: Promise.resolve({ id: SESSION_ID }) };
}

function mockActor(role: "instructor" | "manager" | "super_admin", userId = INSTRUCTOR_ID) {
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: {
      user: { id: userId },
      profile: { first_name: "Alex", last_name: "Instructor" },
      effectiveRole: role,
    },
  });
}

/** Sets up admin.from to hand back the given chains in call order. */
function mockFromSequence(chains: ReturnType<typeof chain>[]) {
  const mockFrom = vi.fn();
  chains.forEach((c) => mockFrom.mockReturnValueOnce(c));
  // Any calls beyond the provided sequence (e.g. notification queries) resolve empty.
  mockFrom.mockReturnValue(chain({ data: [], error: null }));
  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from: mockFrom });
  return mockFrom;
}

const FUTURE_SESSION = {
  id: SESSION_ID,
  instructor_id: INSTRUCTOR_ID,
  status: "scheduled",
  starts_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), // 72h out
  class_types: { name: "BLS Provider" },
  locations: { name: "HQ", city: "Tampa", state: "FL" },
};

const NEAR_SESSION = {
  ...FUTURE_SESSION,
  starts_at: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(), // 10h out
};

describe("POST /api/sessions/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("instructor can cancel their own session more than 48 hours out", async () => {
    mockActor("instructor");
    mockFromSequence([
      chain({ data: FUTURE_SESSION, error: null }), // fetch session
      chain({ data: null, error: null }), // update
    ]);

    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.ok).toBe(true);
  });

  test("instructor is blocked from cancelling their own session within 48 hours", async () => {
    mockActor("instructor");
    mockFromSequence([chain({ data: NEAR_SESSION, error: null })]);

    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/call daniel/i);
  });

  test("manager can cancel a session within 48 hours (not restricted by the window)", async () => {
    mockActor("manager");
    mockFromSequence([
      chain({ data: NEAR_SESSION, error: null }),
      chain({ data: null, error: null }),
    ]);

    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(200);
  });

  test("instructor cannot cancel a session they don't own", async () => {
    mockActor("instructor", OTHER_INSTRUCTOR_ID);
    mockFromSequence([chain({ data: FUTURE_SESSION, error: null })]);

    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/only cancel your own/i);
  });

  test("returns 409 when the session is already cancelled", async () => {
    mockActor("manager");
    mockFromSequence([
      chain({ data: { ...FUTURE_SESSION, status: "cancelled" }, error: null }),
    ]);

    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(409);
  });

  test("returns 400 when the cancellation reason is too short", async () => {
    mockActor("manager");
    const res = await POST(makeRequest("too short"), params());
    expect(res.status).toBe(400);
  });

  test("returns 404 when the session doesn't exist", async () => {
    mockActor("manager");
    mockFromSequence([chain({ data: null, error: null })]);

    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(404);
  });
});
