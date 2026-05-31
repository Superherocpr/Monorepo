/**
 * Unit tests for POST /api/contact (app/api/contact/route.ts)
 *
 * Tests the request validation, captcha gating, DB insert path, and error
 * handling without hitting any real external services.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server — prevents Next.js cookies() runtime requirement
 *   @/lib/turnstile       — controls captcha pass/fail per test
 *   resend                — prevents real email sends
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

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: "email-id" }, error: null }),
    },
  })),
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
    // Unset RESEND_API_KEY so email is skipped and we get a clean 200
    delete process.env.RESEND_API_KEY;
  });

  test("returns 200 with success:true for a valid submission", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
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
