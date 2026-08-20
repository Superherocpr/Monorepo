/**
 * Unit tests for POST /api/sessions/notify-unclaimed-opportunities
 * (app/api/sessions/notify-unclaimed-opportunities/route.ts)
 *
 * Tests cron-secret gating, the Eastern-hour self-gate (the cron fires 12x/day
 * to cover both EST and EDT, so the route must no-op the other 6), the empty
 * case, and that found sessions produce a digest email and get marked
 * escalated (idempotency marker written).
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server — prevents Next.js cookies() runtime requirement
 *   resend                — prevents real email sends
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/sessions/notify-unclaimed-opportunities/route";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
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

const CRON_SECRET = "test-cron-secret-abc123";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.update = vi.fn(self);
  c.eq = vi.fn(self);
  c.is = vi.fn(self);
  c.lte = vi.fn(self);
  c.in = vi.fn(self);
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

function cronRequest(): Request {
  return new Request("https://superherocpr.com/api/sessions/notify-unclaimed-opportunities", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
}

function mockFromSequence(chains: ReturnType<typeof chain>[]) {
  const mockFrom = vi.fn();
  chains.forEach((c) => mockFrom.mockReturnValueOnce(c));
  mockFrom.mockReturnValue(chain({ data: [], error: null }));
  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from: mockFrom });
  return mockFrom;
}

const UNCLAIMED_SESSION = {
  id: "66666666-6666-6666-6666-666666666666",
  starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  class_types: { name: "BLS Provider" },
  locations: { name: "HQ" },
};

describe("POST /api/sessions/notify-unclaimed-opportunities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "no-reply@superherocpr.com";
    // Default to a known on-schedule moment (9am EST = 14:00 UTC in January,
    // standard time) so the existing behavioral tests below don't depend on
    // whatever real wall-clock hour the test happens to run at.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Eastern-hour self-gate", () => {
    test("no-ops without querying opportunity data when the current Eastern hour isn't a target hour", async () => {
      vi.setSystemTime(new Date("2026-01-15T15:00:00.000Z")); // 10am EST — not a target hour
      const mockFrom = mockFromSequence([]);
      const res = await POST(cronRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.notified).toBe(0);
      expect(json.data.skipped).toBeDefined();

      // The heartbeat wrapper (migration 0057) writes a cron_run_log row on every
      // cron-invoked call, deliberately including self-gated no-ops — "ran and did
      // nothing" has to be distinguishable from "never ran". What must NOT happen
      // off-schedule is any query against opportunity data.
      const tablesTouched = mockFrom.mock.calls.map((c) => c[0]);
      expect(tablesTouched.filter((t) => t !== "cron_run_log")).toEqual([]);
    });

    test("runs at 9am Eastern during standard time (EST, UTC-5)", async () => {
      vi.setSystemTime(new Date("2026-01-15T14:00:00.000Z")); // 9am EST
      mockFromSequence([chain({ data: [], error: null })]);
      const res = await POST(cronRequest());
      const json = await res.json();
      expect(json.data.skipped).toBeUndefined();
    });

    test("runs at 9am Eastern during daylight time (EDT, UTC-4) — DST-aware", async () => {
      vi.setSystemTime(new Date("2026-07-15T13:00:00.000Z")); // 9am EDT
      mockFromSequence([chain({ data: [], error: null })]);
      const res = await POST(cronRequest());
      const json = await res.json();
      expect(json.data.skipped).toBeUndefined();
    });

    test("runs at midnight Eastern", async () => {
      vi.setSystemTime(new Date("2026-01-15T05:00:00.000Z")); // 12am EST
      mockFromSequence([chain({ data: [], error: null })]);
      const res = await POST(cronRequest());
      const json = await res.json();
      expect(json.data.skipped).toBeUndefined();
    });
  });

  test("returns 401 without a valid cron secret", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(new Request("https://superherocpr.com/x", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  test("returns notified: 0 when there are no unclaimed sessions", async () => {
    mockFromSequence([chain({ data: [], error: null })]);
    const res = await POST(cronRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.notified).toBe(0);
  });

  test("sends a digest and marks sessions escalated when unclaimed sessions are found", async () => {
    const mockFrom = mockFromSequence([
      chain({ data: [UNCLAIMED_SESSION], error: null }), // query unclaimed
      chain({ data: [{ email: "admin@superherocpr.com" }], error: null }), // super_admins
      chain({ data: null, error: null }), // mark escalated
    ]);

    const res = await POST(cronRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.notified).toBe(1);

    // Third call is the escalation-marking update
    const updateChain = mockFrom.mock.results[2].value as { update: ReturnType<typeof vi.fn> };
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ unclaimed_escalation_sent_at: expect.any(String) })
    );
  });

  test("returns 500 when the query fails", async () => {
    mockFromSequence([chain({ data: null, error: { message: "DB error" } })]);
    const res = await POST(cronRequest());
    expect(res.status).toBe(500);
  });
});
