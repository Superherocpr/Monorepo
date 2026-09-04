/**
 * Send tests for POST /api/admin/daily-summary.
 *
 * The digest is the owner's daily read on the business, and it also carries
 * the two health banners (data-consistency invariants and overdue cron jobs)
 * that surface problems nothing else reports. It runs unattended on cron, so
 * the failure everyone should fear is the quiet one: the job "succeeds" while
 * nobody receives anything.
 *
 * That is the behaviour pinned hardest here — when zero recipients actually
 * receive the digest, the route returns 500 so withCronHeartbeat records a
 * FAILED run. A broken mailer cannot escalate by email (it would need the
 * mailer), so the heartbeat is the only channel left, and it only works if the
 * route is honest about having delivered nothing.
 *
 * Every data query is stubbed empty; the digest content itself is covered by
 * the render contract in tests/unit/lib/emails-render.test.ts.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const sendEmailsMock = vi.fn();
vi.mock("@/lib/send-email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true, id: "email-1" }),
  sendEmails: (...args: unknown[]) => sendEmailsMock(...args),
  isEmailConfigured: () => true,
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/effective-role", () => ({ requireApiRole: vi.fn() }));

vi.mock("@/lib/cron-heartbeat", () => ({
  isCronRequest: () => true,
  withCronHeartbeat: (_name: string, handler: (req: Request) => Promise<Response>) => handler,
  summarizeCronHealth: () => ({ jobsTracked: 9, overdue: [], healthy: true }),
  fetchCronHealth: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/health-invariants", () => ({
  fetchHealthInvariants: vi.fn().mockResolvedValue([]),
  summarizeInvariants: () => ({
    checksRun: 12,
    breachedCount: 0,
    criticalBreaches: 0,
    warningBreaches: 0,
    healthy: true,
    breached: [],
  }),
}));

import { POST } from "@/app/api/admin/daily-summary/route";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Admin client where every query resolves empty except `profiles`, which
 * returns the digest recipients.
 */
function mockClient(recipients: Array<{ id: string; email: string | null; first_name: string }>) {
  const from = vi.fn((table: string) => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    for (const method of ["select", "eq", "gte", "lte", "lt", "gt", "in", "order", "neq", "is"]) {
      c[method] = vi.fn(self);
    }
    const result = table === "profiles" ? { data: recipients, error: null } : { data: [], error: null };
    c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return c;
  });

  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from });
}

function cronRequest(): Request {
  return new Request("https://superherocpr.com/api/admin/daily-summary", {
    method: "POST",
    headers: { Authorization: "Bearer test-secret" },
  });
}

const ADMINS = [
  { id: "a1", email: "boss@superherocpr.com", first_name: "Nate" },
  { id: "a2", email: "manager@superherocpr.com", first_name: "Sam" },
];

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailsMock.mockResolvedValue({ sent: 2, failed: 0, results: [] });
});

describe("POST /api/admin/daily-summary", () => {
  test("sends one digest per recipient, not one shared multi-recipient send", async () => {
    mockClient(ADMINS);

    const res = await POST(cronRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, sent: 2, recipients: 2 });

    expect(sendEmailsMock).toHaveBeenCalledTimes(1);
    const batch = sendEmailsMock.mock.calls[0][0] as Array<Record<string, string>>;
    // One bad address must not cost every other admin the digest.
    expect(batch).toHaveLength(2);
    expect(batch.map((e) => e.to)).toEqual([
      "boss@superherocpr.com",
      "manager@superherocpr.com",
    ]);
    expect(new Set(batch.map((e) => e.context))).toEqual(new Set(["admin/daily-summary"]));
    expect(batch[0].subject).toContain("Daily Summary");
  });

  test("returns 500 when the digest reached nobody", async () => {
    mockClient(ADMINS);
    sendEmailsMock.mockResolvedValue({ sent: 0, failed: 2, results: [] });

    const res = await POST(cronRequest());

    // The whole point: a broken mailer cannot report itself by email, so the
    // cron heartbeat must see a failed run rather than a healthy no-op.
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false });
  });

  test("still reports success when some recipients got it", async () => {
    mockClient(ADMINS);
    sendEmailsMock.mockResolvedValue({ sent: 1, failed: 1, results: [] });

    const res = await POST(cronRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, sent: 1, failed: 1 });
  });

  test("skips a recipient row with no email address", async () => {
    mockClient([...ADMINS, { id: "a3", email: null, first_name: "Ghost" }]);

    await POST(cronRequest());

    const batch = sendEmailsMock.mock.calls[0][0] as Array<Record<string, string>>;
    expect(batch).toHaveLength(2);
  });

  test("sends nothing when there are no admin recipients at all", async () => {
    mockClient([]);

    const res = await POST(cronRequest());
    const json = await res.json();

    // No recipients configured is a different condition from a failed
    // delivery, so this stays a success — there was nothing to deliver.
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, sent: 0 });
    expect(sendEmailsMock).not.toHaveBeenCalled();
  });
});
