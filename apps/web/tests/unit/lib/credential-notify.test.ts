/**
 * Unit tests for lib/credential-notify.ts — notifyCredentialProblems.
 *
 * This is the alert that fires when a third-party credential (PayPal, Resend,
 * Google, Turnstile) is dead or expiring. Credentials fail silently — the
 * feature they back degrades quietly rather than erroring — so this email is
 * the only signal a human ever gets.
 *
 * Two behaviours are load-bearing and both are covered here:
 *   1. It sends when something is actually wrong, and stays silent otherwise.
 *      A weekly "all good" email is trained-to-ignore within a month.
 *   2. It sends ONLY from production. Staging inherits most credentials from
 *      the app-level Amplify config and holds the same real super_admin
 *      addresses, so without the guard one dead key produces two identical
 *      alerts a week to the same people — and a duplicated alert gets filtered.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  sendEmails: vi.fn(),
  isEmailConfigured: () => true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

import { notifyCredentialProblems, credentialAlertEmail } from "@/lib/credential-notify";
import { createAdminClient } from "@/lib/supabase/server";
import type { CredentialProbe, ProbeSummary } from "@/lib/credential-probes";

const ORIGINAL_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL;

/** A dead-credential probe. */
function deadProbe(over: Partial<CredentialProbe> = {}): CredentialProbe {
  return {
    key: "resend",
    label: "Resend API key",
    status: "dead",
    detail: "401 Unauthorized",
    daysUntilExpiry: null,
    ...over,
  } as CredentialProbe;
}

/** Builds a summary in the shape summarizeProbes() returns. */
function summary(over: Partial<ProbeSummary> = {}): ProbeSummary {
  const actionable = over.actionable ?? [deadProbe()];
  return {
    probesRun: 6,
    healthy: false,
    actionable,
    dead: actionable,
    failed: [],
    degraded: [],
    expiring: [],
    ...over,
  } as ProbeSummary;
}

/** Admin client returning the given super_admin rows. */
function mockAdmins(rows: { email: string | null }[]) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve: (v: { data: unknown }) => unknown) =>
      Promise.resolve({ data: rows }).then(resolve),
  };
  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    from: vi.fn(() => chain),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
  process.env.NEXT_PUBLIC_BASE_URL = "https://superherocpr.com";
  mockAdmins([{ email: "boss@superherocpr.com" }]);
});

afterEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = ORIGINAL_BASE_URL;
});

describe("notifyCredentialProblems", () => {
  test("alerts super_admins when a credential is dead", async () => {
    await notifyCredentialProblems(summary());

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string[];
      subject: string;
      html: string;
    };
    expect(call.context).toBe("credential-notify:alert");
    expect(call.to).toEqual(["boss@superherocpr.com"]);
    expect(call.subject).toContain("credential");
    expect(call.html).toContain("Resend API key");
  });

  test("stays silent when everything is healthy", async () => {
    await notifyCredentialProblems(summary({ healthy: true, actionable: [] }));

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("stays silent when nothing is actionable", async () => {
    await notifyCredentialProblems(summary({ actionable: [] }));

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("does not alert from staging — production is the only sender", async () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://staging.superherocpr.com";

    await notifyCredentialProblems(summary());

    // Staging still runs the probe and still writes its heartbeat; it just
    // must not duplicate production's alert to the same two people.
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("does not alert when the base URL is unparseable", async () => {
    process.env.NEXT_PUBLIC_BASE_URL = "not a url";

    await notifyCredentialProblems(summary());

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sends nothing when no active super_admin has an email", async () => {
    mockAdmins([{ email: null }]);

    await notifyCredentialProblems(summary());

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("credentialAlertEmail", () => {
  test("names the failing credential and escapes its detail text", () => {
    const { subject, html } = credentialAlertEmail(
      summary({ actionable: [deadProbe({ detail: `<script>alert('x')</script>` })] }),
      "https://superherocpr.com"
    );

    expect(subject).toContain("need attention");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
