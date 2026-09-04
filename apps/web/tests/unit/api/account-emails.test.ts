/**
 * Send tests for the account-lifecycle email routes.
 *
 * These four routes are thin, which is exactly why they had no tests and why
 * the sends were worth pinning down: each one exists almost entirely to put a
 * single email in front of a person, so a dropped send leaves no other trace.
 *
 *   POST /api/emails/welcome                    — booking-flow account creation
 *   POST /api/auth/register                     — public self-service signup
 *   POST /api/customers/[id]/send-password-reset — staff resets a customer
 *   POST /api/staff/[id]/resend-invite           — admin re-invites staff
 *
 * The last two differ from the rest of the system in an important way: for
 * them, sending IS the operation, so a mail failure is fatal and surfaces as a
 * 500 to the person who clicked, rather than being swallowed best-effort.
 * Both directions of that are covered.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  sendEmails: vi.fn(),
  isEmailConfigured: () => true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/effective-role", () => ({
  requireApiRole: vi.fn(),
}));

import { POST as welcomePOST } from "@/app/api/emails/welcome/route";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import { POST as resetPOST } from "@/app/api/customers/[id]/send-password-reset/route";
import { POST as resendInvitePOST } from "@/app/api/staff/[id]/resend-invite/route";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_ID = "22222222-2222-2222-2222-222222222222";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.insert = vi.fn(self);
  c.eq = vi.fn(self);
  c.neq = vi.fn(self);
  c.single = vi.fn(() => Promise.resolve(result));
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: { user: { id: USER_ID }, profile: {}, effectiveRole: "super_admin" },
  });
});

describe("POST /api/emails/welcome", () => {
  test("sends the welcome email to the new customer", async () => {
    const res = await welcomePOST(
      jsonRequest("https://superherocpr.com/api/emails/welcome", {
        firstName: "Dana",
        email: "dana@example.com",
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, emailSent: true });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string;
      subject: string;
      html: string;
    };
    expect(call.context).toBe("emails/welcome");
    expect(call.to).toBe("dana@example.com");
    expect(call.html).toContain("Dana");
  });

  test("reports emailSent:false rather than pretending, when the send fails", async () => {
    sendEmailMock.mockResolvedValue({ sent: false, reason: "failed", error: "boom" });

    const res = await welcomePOST(
      jsonRequest("https://superherocpr.com/api/emails/welcome", {
        firstName: "Dana",
        email: "dana@example.com",
      })
    );

    // The booking flow must not be blocked, but it must not be lied to either.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, emailSent: false });
  });

  test("sends nothing when required fields are missing", async () => {
    const res = await welcomePOST(
      jsonRequest("https://superherocpr.com/api/emails/welcome", { firstName: "Dana" })
    );

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/register", () => {
  /** Admin client for a successful signup: no duplicate, user + profile created. */
  function mockSignupClient(opts: { existing?: unknown; profileError?: unknown } = {}) {
    (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn(() =>
        chain({ data: opts.existing ?? null, error: opts.profileError ?? null })
      ),
      auth: {
        admin: {
          createUser: vi
            .fn()
            .mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
          deleteUser: vi.fn().mockResolvedValue({}),
        },
      },
    });
  }

  const validBody = {
    firstName: "Dana",
    lastName: "Scully",
    email: "Dana@Example.com",
    password: "correct-horse-battery",
    phone: "(813) 555-0100",
  };

  test("sends the welcome email after a successful signup", async () => {
    mockSignupClient();

    const res = await registerPOST(
      jsonRequest("https://superherocpr.com/api/auth/register", validBody)
    );

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string;
      idempotencyKey: string;
    };
    expect(call.context).toBe("auth/register:welcome");
    // Address is normalised to lowercase before the account is created, so the
    // welcome must go to the same normalised address.
    expect(call.to).toBe("dana@example.com");
    expect(call.idempotencyKey).toBe(`welcome-${USER_ID}`);
  });

  test("sends nothing when the email is already registered", async () => {
    mockSignupClient({ existing: { id: "someone-else" } });

    const res = await registerPOST(
      jsonRequest("https://superherocpr.com/api/auth/register", validBody)
    );

    expect(res.status).toBe(409);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sends nothing when validation rejects the signup", async () => {
    mockSignupClient();

    const res = await registerPOST(
      jsonRequest("https://superherocpr.com/api/auth/register", {
        ...validBody,
        phone: "",
      })
    );

    // Phone is required on every account in this system.
    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/customers/[id]/send-password-reset", () => {
  function mockCustomer(customer: unknown, actionLink: string | null = "https://reset.link") {
    (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn(() => chain({ data: customer, error: null })),
      auth: {
        admin: {
          generateLink: vi.fn().mockResolvedValue({
            data: actionLink ? { properties: { action_link: actionLink } } : null,
            error: actionLink ? null : { message: "failed" },
          }),
        },
      },
    });
  }

  function params() {
    return { params: Promise.resolve({ id: TARGET_ID }) };
  }

  test("emails the customer their reset link", async () => {
    mockCustomer({ email: "dana@example.com", first_name: "Dana" });

    const res = await resetPOST(new Request("https://x/api"), params());

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as { context: string; to: string; html: string };
    expect(call.context).toBe("customers/send-password-reset");
    expect(call.to).toBe("dana@example.com");
    expect(call.html).toContain("https://reset.link");
  });

  test("returns 500 when the send fails — this route exists to send", async () => {
    mockCustomer({ email: "dana@example.com", first_name: "Dana" });
    sendEmailMock.mockResolvedValue({ sent: false, reason: "failed", error: "boom" });

    const res = await resetPOST(new Request("https://x/api"), params());

    // Staff clicked a button whose whole purpose was the email; telling them it
    // worked when it did not is the failure mode being prevented.
    expect(res.status).toBe(500);
  });

  test("sends nothing when the customer does not exist", async () => {
    mockCustomer(null);

    const res = await resetPOST(new Request("https://x/api"), params());

    expect(res.status).toBe(404);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/staff/[id]/resend-invite", () => {
  function mockStaff(profile: unknown, hashedToken: string | null = "tok123") {
    (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn(() => chain({ data: profile, error: profile ? null : { message: "x" } })),
      auth: {
        admin: {
          generateLink: vi.fn().mockResolvedValue({
            data: hashedToken ? { properties: { hashed_token: hashedToken } } : null,
            error: hashedToken ? null : { message: "failed" },
          }),
        },
      },
    });
  }

  function params() {
    return { params: Promise.resolve({ id: TARGET_ID }) };
  }

  const ACTIVE_INSTRUCTOR = {
    id: TARGET_ID,
    first_name: "Alex",
    email: "alex@example.com",
    role: "instructor",
    deactivated: false,
  };

  test("re-sends the invite with a fresh setup link", async () => {
    mockStaff(ACTIVE_INSTRUCTOR);

    const res = await resendInvitePOST(new Request("https://x/api"), params());

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as { context: string; to: string; html: string };
    expect(call.context).toBe("staff/resend-invite");
    expect(call.to).toBe("alex@example.com");
    // The link must carry the freshly generated token, not a stale one.
    expect(call.html).toContain("token_hash=tok123");
  });

  test("does not re-invite a deactivated account", async () => {
    mockStaff({ ...ACTIVE_INSTRUCTOR, deactivated: true });

    const res = await resendInvitePOST(new Request("https://x/api"), params());

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("returns 500 when the send fails — this route exists to send", async () => {
    mockStaff(ACTIVE_INSTRUCTOR);
    sendEmailMock.mockResolvedValue({ sent: false, reason: "failed", error: "boom" });

    const res = await resendInvitePOST(new Request("https://x/api"), params());

    expect(res.status).toBe(500);
  });
});
