/**
 * Send tests for POST /api/certifications/send-reminders.
 *
 * This job is the only thing that tells a customer their certification is
 * about to lapse, and it runs unattended on a daily cron. Two of its rules are
 * subtle enough that they were previously wrong in production, and both are
 * pinned here:
 *
 *   1. **The milestone is stamped only after a confirmed send.** Stamping
 *      first meant one failed send permanently suppressed that customer's
 *      reminder for that milestone — the next run would skip them as "already
 *      reminded" and the cert would quietly expire.
 *
 *   2. **A missing Resend config is a 500, not `count: 0`.** Returning success
 *      with a zero count is indistinguishable from "nothing was due", so the
 *      cron heartbeat recorded a healthy run forever while nothing was sent.
 *
 * @/lib/cron-heartbeat is mocked so the handler runs directly without the
 * heartbeat wrapper's own DB writes.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
const isEmailConfiguredMock = vi.fn().mockReturnValue(true);
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  sendEmails: vi.fn(),
  isEmailConfigured: () => isEmailConfiguredMock(),
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/effective-role", () => ({ requireApiRole: vi.fn() }));

vi.mock("@/lib/cron-heartbeat", () => ({
  isCronRequest: () => true,
  // Identity wrapper: run the handler, skip the cron_run_log bookkeeping.
  withCronHeartbeat: (_name: string, handler: (req: Request) => Promise<Response>) => handler,
}));

import { POST } from "@/app/api/certifications/send-reminders/route";
import { createAdminClient } from "@/lib/supabase/server";

/** Days from now, as the YYYY-MM-DD-ish ISO string the route parses. */
function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** One certification row joined with its customer profile and cert type. */
function cert(over: Record<string, unknown> = {}) {
  return {
    id: "cert-1",
    expires_at: inDays(29),
    last_reminder_sent_days: null,
    profiles: { first_name: "Dana", email: "dana@example.com" },
    cert_types: { name: "BLS Provider" },
    ...over,
  };
}

/** Captures the certifications.update() calls so milestone stamping is assertable. */
let stamped: Array<{ id: unknown; values: Record<string, unknown> }> = [];

/** Builds the admin client: settings read, certs read, then per-cert updates. */
function mockClient(certs: Record<string, unknown>[], paused = false) {
  stamped = [];

  const from = vi.fn((table: string) => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    c.select = vi.fn(self);
    c.eq = vi.fn((_col: string, value: unknown) => {
      // On an update chain, .eq("id", certId) is what identifies the row.
      if (c.__updateValues) {
        stamped.push({ id: value, values: c.__updateValues as Record<string, unknown> });
      }
      return c;
    });
    c.gte = vi.fn(self);
    c.lte = vi.fn(self);
    c.update = vi.fn((values: Record<string, unknown>) => {
      c.__updateValues = values;
      return c;
    });
    c.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: paused ? { value: "true" } : null, error: null })
    );

    const result =
      table === "certifications" ? { data: certs, error: null } : { data: null, error: null };
    c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
    return c;
  });

  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from });
  return { from };
}

function cronRequest(): Request {
  return new Request("https://superherocpr.com/api/certifications/send-reminders", {
    method: "POST",
    headers: { Authorization: "Bearer test-secret" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
  isEmailConfiguredMock.mockReturnValue(true);
});

describe("POST /api/certifications/send-reminders", () => {
  test("emails a customer whose cert has reached a milestone", async () => {
    mockClient([cert()]);

    const res = await POST(cronRequest());
    const json = await res.json();

    expect(json).toMatchObject({ success: true, count: 1, failed: 0 });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string;
      html: string;
      idempotencyKey: string;
    };
    expect(call.context).toBe("certifications/send-reminders");
    expect(call.to).toBe("dana@example.com");
    expect(call.html).toContain("BLS Provider");
    // Keyed on cert + milestone so a retry of the whole run cannot double-send.
    expect(call.idempotencyKey).toBe("cert-reminder-cert-1-30");
  });

  test("stamps the milestone only after the send succeeds", async () => {
    mockClient([cert()]);

    await POST(cronRequest());

    expect(stamped).toEqual([{ id: "cert-1", values: { last_reminder_sent_days: 30 } }]);
  });

  test("does NOT stamp the milestone when the send fails", async () => {
    mockClient([cert()]);
    sendEmailMock.mockResolvedValue({ sent: false, reason: "failed", error: "boom" });

    const res = await POST(cronRequest());
    const json = await res.json();

    // Stamping here would permanently suppress this customer's reminder for
    // this milestone — the next run would skip them as already reminded.
    expect(stamped).toEqual([]);
    expect(json).toMatchObject({ count: 0, failed: 1 });
  });

  test("skips a cert already reminded at this milestone or closer", async () => {
    mockClient([cert({ last_reminder_sent_days: 30 })]);

    await POST(cronRequest());

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("still emails a cert that has moved to a closer milestone", async () => {
    // Reminded at 30 days out; now inside the 7-day window, which is a new,
    // more urgent milestone and earns another email.
    mockClient([cert({ expires_at: inDays(5), last_reminder_sent_days: 30 })]);

    await POST(cronRequest());

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(
      (sendEmailMock.mock.calls[0][0] as { idempotencyKey: string }).idempotencyKey
    ).toBe("cert-reminder-cert-1-7");
  });

  test("returns 500 instead of a silent success when Resend is not configured", async () => {
    mockClient([cert()]);
    isEmailConfiguredMock.mockReturnValue(false);

    const res = await POST(cronRequest());

    // The heartbeat must record a FAILED run, so the broken mailer surfaces as
    // an overdue job rather than a healthy one that sent nothing.
    expect(res.status).toBe(500);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sends nothing while reminders are paused", async () => {
    mockClient([cert()], true);

    const res = await POST(cronRequest());

    expect(res.status).toBe(403);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("skips a cert whose customer has no email on file", async () => {
    mockClient([cert({ profiles: { first_name: "Dana", email: null } })]);

    const res = await POST(cronRequest());
    const json = await res.json();

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(json).toMatchObject({ count: 0 });
  });
});
