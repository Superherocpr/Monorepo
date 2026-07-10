/**
 * Unit tests for POST /api/sessions/[id]/claim (app/api/sessions/[id]/claim/route.ts)
 *
 * Tests the atomic first-come-first-serve claim, including the race-condition
 * path where a second concurrent request loses.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server     — prevents Next.js cookies() runtime requirement
 *   @/lib/auth/effective-role — session auth resolution
 *   resend                    — prevents real email sends
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/sessions/[id]/claim/route";

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

const CLAIMING_INSTRUCTOR_ID = "44444444-4444-4444-4444-444444444444";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const LOCATION_ID = "55555555-5555-5555-5555-555555555555";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.update = vi.fn(self);
  c.eq = vi.fn(self);
  c.is = vi.fn(self);
  c.in = vi.fn(self);
  c.single = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

function makeRequest(locationId: string | undefined = LOCATION_ID): Request {
  return new Request(`https://superherocpr.com/api/sessions/${SESSION_ID}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(locationId === undefined ? {} : { location_id: locationId }),
  });
}

function params() {
  return { params: Promise.resolve({ id: SESSION_ID }) };
}

function mockActor() {
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: {
      user: { id: CLAIMING_INSTRUCTOR_ID },
      profile: { first_name: "Jamie", last_name: "Claimer" },
      effectiveRole: "instructor",
    },
  });
}

function mockFromSequence(chains: ReturnType<typeof chain>[]) {
  const mockFrom = vi.fn();
  chains.forEach((c) => mockFrom.mockReturnValueOnce(c));
  mockFrom.mockReturnValue(chain({ data: [], error: null }));
  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from: mockFrom });
  return mockFrom;
}

const LOCATION = { id: LOCATION_ID, name: "Downtown", city: "Tampa", state: "FL" };
const OPEN_SESSION = {
  id: SESSION_ID,
  instructor_id: null,
  status: "cancelled",
  starts_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
  class_types: { name: "BLS Provider" },
};

describe("POST /api/sessions/[id]/claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActor();
  });

  test("successfully claims an open session", async () => {
    mockFromSequence([
      chain({ data: LOCATION, error: null }), // fetch location
      chain({ data: OPEN_SESSION, error: null }), // fetch session
      chain({
        data: { id: SESSION_ID, instructor_id: CLAIMING_INSTRUCTOR_ID },
        error: null,
      }), // atomic update succeeds
      chain({ data: { phone: "555-1234" }, error: null }), // claiming profile phone
    ]);

    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.ok).toBe(true);
  });

  test("returns 409 when a concurrent request already claimed the session", async () => {
    mockFromSequence([
      chain({ data: LOCATION, error: null }),
      chain({ data: OPEN_SESSION, error: null }),
      // Atomic update's WHERE instructor_id IS NULL matched nothing — .single() errors
      chain({ data: null, error: { message: "no rows" } }),
    ]);

    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/just claimed/i);
  });

  test("returns 400 when location_id is missing", async () => {
    const res = await POST(makeRequest(undefined), params());
    expect(res.status).toBe(400);
  });

  test("returns 400 when the location doesn't exist", async () => {
    mockFromSequence([chain({ data: null, error: null })]);
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(400);
  });

  test("returns 404 when the session doesn't exist", async () => {
    mockFromSequence([
      chain({ data: LOCATION, error: null }),
      chain({ data: null, error: null }),
    ]);
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(404);
  });

  test("returns 400 when the session isn't cancelled", async () => {
    mockFromSequence([
      chain({ data: LOCATION, error: null }),
      chain({ data: { ...OPEN_SESSION, status: "scheduled" }, error: null }),
    ]);
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(400);
  });

  test("returns 409 when the pre-check finds the session already claimed", async () => {
    mockFromSequence([
      chain({ data: LOCATION, error: null }),
      chain({ data: { ...OPEN_SESSION, instructor_id: "someone-else" }, error: null }),
    ]);
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(409);
  });
});
