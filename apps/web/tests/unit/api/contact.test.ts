/**
 * Unit tests for POST /api/contact (app/api/contact/route.ts)
 *
 * Tests the request validation, captcha gating, DB insert path, and error
 * handling without hitting any real external services.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server — prevents Next.js cookies() runtime requirement
 *   @/lib/turnstile       — controls captcha pass/fail per test
 *   @/lib/send-email      — prevents real sends AND lets the tests assert them
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/contact/route";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
  getClientIp: vi.fn().mockReturnValue(null),
}));

/**
 * Mocked at the wrapper rather than at `resend`, so the tests can assert which
 * emails the route decided to send. The contact route uses the plural form.
 */
const sendEmailsMock = vi.fn();
vi.mock("@/lib/send-email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: true, id: "email-1" }),
  sendEmails: (...args: unknown[]) => sendEmailsMock(...args),
  isEmailConfigured: () => true,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import { verifyTurnstileToken } from "@/lib/turnstile";

/** Returns a Request object with a JSON body pre-populated with valid fields. */
function makeRequest(overrides: Record<string, unknown> = {}): Request {
  const body = {
    name: "Alice Smith",
    email: "alice@example.com",
    phone: "555-1234",
    inquiryType: "General Question",
    message: "Hello, I have a question.",
    captchaToken: "valid-token",
    ...overrides,
  };
  return new Request("https://superherocpr.com/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Configures the mock Supabase client to simulate a successful DB insert. */
function mockDbSuccess() {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockResolvedValue({ error: null }),
  });
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from: mockFrom });
}

/** Configures the mock Supabase client to simulate a DB error. */
function mockDbError(message = "DB write failed") {
  const mockFrom = vi.fn().mockReturnValue({
    insert: vi.fn().mockResolvedValue({ error: { message } }),
  });
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ from: mockFrom });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/contact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: captcha passes, DB succeeds
    (verifyTurnstileToken as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    mockDbSuccess();
    sendEmailsMock.mockResolvedValue({ sent: 2, failed: 0, results: [] });
  });

  test("returns 200 with success:true for a valid submission", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test("sends both the business notification and the visitor auto-reply", async () => {
    await POST(makeRequest());

    expect(sendEmailsMock).toHaveBeenCalledTimes(1);
    const batch = sendEmailsMock.mock.calls[0][0] as Array<Record<string, string>>;
    expect(batch.map((e) => e.context)).toEqual(["contact:business", "contact:auto-reply"]);

    const [business, autoReply] = batch;
    // Replies to the business copy must go to the visitor, so staff can answer
    // without digging the address out of the body.
    expect(business.replyTo).toBe("alice@example.com");
    expect(autoReply.to).toBe("alice@example.com");
    expect(business.subject).toContain("General Question");
    expect(autoReply.html).toContain("Alice");
  });

  test("does not email when the submission is rejected", async () => {
    (verifyTurnstileToken as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false });

    await POST(makeRequest());

    expect(sendEmailsMock).not.toHaveBeenCalled();
  });

  test("returns 400 when the request body is not valid JSON", async () => {
    const req = new Request("https://superherocpr.com/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 when the captcha token is rejected", async () => {
    (verifyTurnstileToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: "Captcha verification failed. Please try again.",
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test("returns 400 when a required field is missing", async () => {
    const res = await POST(makeRequest({ name: "" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/missing|required/i);
  });

  test("returns 400 for an invalid email format", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  test("returns 400 when phone is missing", async () => {
    const res = await POST(makeRequest({ phone: "" }));
    expect(res.status).toBe(400);
  });

  test("returns 400 when message is missing", async () => {
    const res = await POST(makeRequest({ message: "  " }));
    expect(res.status).toBe(400);
  });

  test("returns 500 when the DB insert fails", async () => {
    mockDbError("unique constraint");
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});
