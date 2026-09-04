/**
 * Send tests for POST /api/auth/reset-password (self-service forgot-password).
 *
 * Losing a password-reset email locks a customer out of their own account, so
 * this is the one flow in the system with a second delivery path: if the
 * branded Resend send fails, it falls back to Supabase's own (unbranded) reset
 * email rather than leaving the person stranded. That fallback is invisible
 * from the response — the route always returns { success: true } to prevent
 * account enumeration — so without these tests there is no way to tell a
 * delivered reset from a silently dropped one.
 *
 * Covered here: the branded send, the fallback when it fails, the fallback
 * when Resend is not configured at all, and the enumeration guarantee that all
 * of these look identical to the caller.
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

import { POST } from "@/app/api/auth/reset-password/route";
import { createAdminClient } from "@/lib/supabase/server";

/** Tracks Supabase's own reset email — the fallback delivery path. */
let supabaseFallbackMock: ReturnType<typeof vi.fn>;

/** Admin client whose generateLink returns `actionLink` (or fails when null). */
function mockClient(actionLink: string | null = "https://supabase.link/recover") {
  supabaseFallbackMock = vi.fn().mockResolvedValue({ error: null });

  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: {
      admin: {
        generateLink: vi.fn().mockResolvedValue({
          data: actionLink ? { properties: { action_link: actionLink } } : null,
          error: actionLink ? null : { message: "user not found" },
        }),
      },
      // Referenced directly rather than wrapped: the mock is created just
      // above, so the client can hold it without an extra indirection.
      resetPasswordForEmail: supabaseFallbackMock,
    },
  });
}

function request(email: unknown): Request {
  return new Request("https://superherocpr.com/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
  isEmailConfiguredMock.mockReturnValue(true);
  mockClient();
});

describe("POST /api/auth/reset-password", () => {
  test("sends the branded reset email carrying the recovery link", async () => {
    const res = await POST(request("dana@example.com"));

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string;
      html: string;
    };
    expect(call.context).toBe("auth/reset-password");
    expect(call.to).toBe("dana@example.com");
    expect(call.html).toContain("https://supabase.link/recover");

    // The branded send worked, so the unbranded fallback must stay unused.
    expect(supabaseFallbackMock).not.toHaveBeenCalled();
  });

  test("falls back to Supabase's own reset email when the branded send fails", async () => {
    sendEmailMock.mockResolvedValue({ sent: false, reason: "failed", error: "boom" });

    const res = await POST(request("dana@example.com"));

    expect(res.status).toBe(200);
    // Being locked out of your account is worse than an unbranded email.
    expect(supabaseFallbackMock).toHaveBeenCalledTimes(1);
    expect(supabaseFallbackMock.mock.calls[0][0]).toBe("dana@example.com");
  });

  test("uses the Supabase fallback when Resend is not configured at all", async () => {
    isEmailConfiguredMock.mockReturnValue(false);

    const res = await POST(request("dana@example.com"));

    expect(res.status).toBe(200);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(supabaseFallbackMock).toHaveBeenCalledTimes(1);
  });

  test("reports success without sending for an unknown account", async () => {
    mockClient(null); // generateLink fails: no such user

    const res = await POST(request("nobody@example.com"));

    // Account enumeration guard: an unknown address must be indistinguishable
    // from a known one in the response.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("reports success without sending for a malformed address", async () => {
    const res = await POST(request("not-an-email"));

    expect(await res.json()).toEqual({ success: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
