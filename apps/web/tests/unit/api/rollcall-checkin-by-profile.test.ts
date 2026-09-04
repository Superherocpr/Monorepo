/**
 * Unit tests for POST /api/rollcall/checkin-by-profile
 * (app/api/rollcall/checkin-by-profile/route.ts)
 *
 * Covers the rule this route now enforces: the branded rollcall welcome email
 * fires exactly once, at the moment a student is newly confirmed for a
 * session — never on the idempotent "already checked in" path, so a student
 * who re-opens the check-in page doesn't get welcomed twice.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server      — prevents the Next.js cookies() runtime requirement
 *   @/lib/auth/verify-password — password check for the profile-update path
 *   @/lib/send-email           — prevents real email sends
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/rollcall/checkin-by-profile/route";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/verify-password", () => ({
  verifyPassword: vi.fn(),
}));

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { verifyPassword } from "@/lib/auth/verify-password";

const PROFILE_ID = "11111111-1111-1111-1111-111111111111";
const SESSION_ID = "22222222-2222-2222-2222-222222222222";
const BOOKING_ID = "33333333-3333-3333-3333-333333333333";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.update = vi.fn(self);
  c.insert = vi.fn(self);
  c.eq = vi.fn(self);
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.single = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

interface Profile {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const DEFAULT_PROFILE: Profile = {
  first_name: "Dana",
  last_name: "Scully",
  email: "dana@example.com",
  phone: "(813) 555-0100",
  address: null,
  city: null,
  state: null,
  zip: null,
};

/**
 * Builds a fake admin client whose `.from(table)` call returns the right
 * canned response for each of this route's queries, keyed by call order
 * within a table (bookings is queried once; roster_records and profiles are
 * each queried up to twice — a read, then a write).
 */
function mockSupabase(opts: {
  booking?: { id: string } | null;
  existingRecord?: { id: string } | null;
  profile?: Profile | null;
  updateError?: { message: string } | null;
  rosterError?: { message: string } | null;
}) {
  const {
    booking = { id: BOOKING_ID },
    existingRecord = null,
    profile = DEFAULT_PROFILE,
    updateError = null,
    rosterError = null,
  } = opts;

  const callCounts: Record<string, number> = {};

  const client = {
    from: vi.fn((table: string) => {
      callCounts[table] = (callCounts[table] ?? 0) + 1;
      const n = callCounts[table];

      if (table === "bookings") return chain({ data: booking, error: null });

      if (table === "roster_records") {
        // 1st call: the existingRecord idempotency check. 2nd call: the insert.
        return n === 1
          ? chain({ data: existingRecord, error: null })
          : chain({ data: null, error: rosterError });
      }

      if (table === "profiles") {
        // 1st call: the select. 2nd call (updates path only): the update.
        return n === 1
          ? chain({ data: profile, error: null })
          : chain({ data: null, error: updateError });
      }

      throw new Error(`Unexpected table in test: ${table}`);
    }),
    channel: vi.fn(() => ({ httpSend: vi.fn().mockResolvedValue(undefined) })),
  };

  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return client;
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("https://superherocpr.com/api/rollcall/checkin-by-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
});

describe("POST /api/rollcall/checkin-by-profile — welcome email", () => {
  test("sends the welcome email on first confirmation (no updates)", async () => {
    mockSupabase({ existingRecord: null });

    const res = await POST(makeRequest({ profileId: PROFILE_ID, sessionId: SESSION_ID }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, alreadyCheckedIn: false });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe("dana@example.com");
    expect(call.html).toContain("Dana");
  });

  test("does not send the welcome email when already checked in (no updates)", async () => {
    mockSupabase({ existingRecord: { id: "existing-roster-row" } });

    const res = await POST(makeRequest({ profileId: PROFILE_ID, sessionId: SESSION_ID }));
    const json = await res.json();

    expect(json).toMatchObject({ success: true, alreadyCheckedIn: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("skips the email without failing check-in when the profile has no email", async () => {
    mockSupabase({ existingRecord: null, profile: { ...DEFAULT_PROFILE, email: null } });

    const res = await POST(makeRequest({ profileId: PROFILE_ID, sessionId: SESSION_ID }));
    const json = await res.json();

    expect(json).toMatchObject({ success: true, alreadyCheckedIn: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sends the welcome email to the corrected address when updates are submitted", async () => {
    mockSupabase({ existingRecord: null });
    (verifyPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const res = await POST(
      makeRequest({
        profileId: PROFILE_ID,
        sessionId: SESSION_ID,
        password: "correct-horse-battery-staple",
        updates: {
          firstName: "Dana",
          lastName: "Scully",
          email: "dana.new@example.com",
          phone: "(813) 555-0199",
          address: null,
          city: null,
          state: null,
          zip: null,
        },
      })
    );
    const json = await res.json();

    expect(json).toMatchObject({ success: true, alreadyCheckedIn: false });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    // The corrected address, not the stale profile.email — a student who
    // fixes a typo in their email should be welcomed at the address they can
    // actually read.
    expect(sendEmailMock.mock.calls[0][0].to).toBe("dana.new@example.com");
  });

  test("does not send the welcome email when updates are submitted but the student was already checked in", async () => {
    mockSupabase({ existingRecord: { id: "existing-roster-row" } });
    (verifyPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const res = await POST(
      makeRequest({
        profileId: PROFILE_ID,
        sessionId: SESSION_ID,
        password: "correct-horse-battery-staple",
        updates: {
          firstName: "Dana",
          lastName: "Scully",
          email: "dana.new@example.com",
          phone: "(813) 555-0199",
          address: null,
          city: null,
          state: null,
          zip: null,
        },
      })
    );
    const json = await res.json();

    expect(json).toMatchObject({ success: true, alreadyCheckedIn: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("does not send the welcome email when the booking lookup fails", async () => {
    mockSupabase({ booking: null });

    const res = await POST(makeRequest({ profileId: PROFILE_ID, sessionId: SESSION_ID }));

    expect(res.status).toBe(403);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
