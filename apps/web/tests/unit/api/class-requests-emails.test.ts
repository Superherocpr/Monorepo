/**
 * Send tests for the customer-requested-class email flow.
 *
 *   POST /api/class-requests              — request submitted (customer + admins)
 *   POST /api/class-requests/[id]/approve — approved (customer + instructors)
 *   POST /api/class-requests/[id]/reject  — declined (customer)
 *
 * This is a conversation carried entirely over email: a customer asks for a
 * class at their venue, staff decide, and the customer learns the answer only
 * from these messages. There is no page they can check. A dropped send here
 * looks exactly like being ignored.
 *
 * The approve path additionally broadcasts the new session to instructors as a
 * first-come opportunity — if that one goes missing, the class is approved and
 * nobody is ever offered it.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
const sendEmailsMock = vi.fn().mockResolvedValue({ sent: 2, failed: 0, results: [] });
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  sendEmails: (...args: unknown[]) => sendEmailsMock(...args),
  isEmailConfigured: () => true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/effective-role", () => ({ requireApiRole: vi.fn() }));

import { POST as createPOST } from "@/app/api/class-requests/route";
import { POST as rejectPOST } from "@/app/api/class-requests/[id]/reject/route";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const REQUEST_ID = "22222222-2222-2222-2222-222222222222";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  for (const m of ["select", "insert", "update", "eq", "in", "neq", "is", "order", "gte", "lte"]) {
    c[m] = vi.fn(self);
  }
  c.single = vi.fn(() => Promise.resolve(result));
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

/** A date comfortably past the 7-day minimum lead time. */
function futureDate(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    class_type_id: "ct-1",
    preferred_date: futureDate(),
    preferred_time_of_day: "morning",
    group_size: 12,
    contact_phone: "(813) 555-0100",
    venue_name: "Tampa General",
    venue_address: "1 Main St",
    venue_city: "Tampa",
    venue_state: "FL",
    venue_zip: "33601",
    notes: "Parking is out back.",
    ...over,
  };
}

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("https://superherocpr.com/api/class-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
  sendEmailsMock.mockResolvedValue({ sent: 2, failed: 0, results: [] });
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
  });
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: { user: { id: USER_ID }, profile: {}, effectiveRole: "super_admin" },
  });
});

describe("POST /api/class-requests", () => {
  /** Admin client for the submit flow: class type, profile, insert, admins. */
  function mockSubmit(opts: { classType?: unknown; admins?: { email: string | null }[] } = {}) {
    const {
      classType = { id: "ct-1", name: "BLS Provider", duration_minutes: 240 },
      admins = [{ email: "boss@superherocpr.com" }],
    } = opts;

    let profilesCall = 0;
    (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === "class_types") return chain({ data: classType, error: null });
        if (table === "class_requests") return chain({ data: { id: REQUEST_ID }, error: null });
        if (table === "profiles") {
          profilesCall += 1;
          // 1st: the requesting customer. 2nd: the admin fan-out list.
          return profilesCall === 1
            ? chain({
                data: {
                  id: USER_ID,
                  first_name: "Dana",
                  last_name: "Scully",
                  email: "dana@example.com",
                },
                error: null,
              })
            : chain({ data: admins, error: null });
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });
  }

  test("confirms to the customer and notifies the admins", async () => {
    mockSubmit();

    const res = await createPOST(jsonRequest(validBody()));

    expect(res.status).toBe(200);
    expect(sendEmailsMock).toHaveBeenCalledTimes(1);

    const batch = sendEmailsMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(batch.map((e) => e.context)).toEqual([
      "class-requests:customer-confirm",
      "class-requests:admin-notify",
    ]);
    expect(batch[0].to).toBe("dana@example.com");
    expect(batch[1].to).toEqual(["boss@superherocpr.com"]);
    // Keyed on the request so a double-submit cannot double-notify.
    expect(batch[0].idempotencyKey).toBe(`class-request-confirm-${REQUEST_ID}`);
    expect(batch[1].idempotencyKey).toBe(`class-request-admin-${REQUEST_ID}`);
  });

  test("still confirms to the customer when there are no admins to notify", async () => {
    mockSubmit({ admins: [] });

    await createPOST(jsonRequest(validBody()));

    const batch = sendEmailsMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(1);
    expect(batch[0].context).toBe("class-requests:customer-confirm");
  });

  test("sends nothing when the request is rejected for a too-soon date", async () => {
    mockSubmit();

    const res = await createPOST(
      jsonRequest(validBody({ preferred_date: new Date().toISOString().split("T")[0] }))
    );

    expect(res.status).toBe(400);
    expect(sendEmailsMock).not.toHaveBeenCalled();
  });

  test("sends nothing when the caller is not signed in", async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    mockSubmit();

    const res = await createPOST(jsonRequest(validBody()));

    expect(res.status).toBe(401);
    expect(sendEmailsMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/class-requests/[id]/reject", () => {
  function mockReject(requestRow: unknown, updateError: unknown = null) {
    let call = 0;
    (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn(() => {
        call += 1;
        return call === 1
          ? chain({ data: requestRow, error: null })
          : chain({ data: requestRow, error: updateError });
      }),
    });
  }

  function rejectRequest(body: Record<string, unknown>): Request {
    return new Request(`https://superherocpr.com/api/class-requests/${REQUEST_ID}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const PENDING_REQUEST = {
    id: REQUEST_ID,
    status: "pending",
    preferred_date: futureDate(),
    profiles: { first_name: "Dana", email: "dana@example.com" },
    class_types: { name: "BLS Provider" },
  };

  test("tells the customer their request was declined, with the reason", async () => {
    mockReject(PENDING_REQUEST);

    const res = await rejectPOST(rejectRequest({ reason: "No instructor free that week." }), {
      params: Promise.resolve({ id: REQUEST_ID }),
    });

    // The decline email is the only way the customer ever learns the answer.
    if (res.status === 200) {
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      const call = sendEmailMock.mock.calls[0][0] as {
        context: string;
        to: string;
        html: string;
      };
      expect(call.context).toBe("class-requests/reject:customer");
      expect(call.to).toBe("dana@example.com");
      expect(call.html).toContain("No instructor free that week.");
    } else {
      // Route shape differs from the fixture; fail loudly rather than silently
      // passing a test that proved nothing.
      throw new Error(`reject route returned ${res.status}: ${await res.text()}`);
    }
  });
});
