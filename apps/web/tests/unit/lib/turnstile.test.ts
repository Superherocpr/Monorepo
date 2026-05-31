/**
 * Unit tests for lib/turnstile.ts
 *
 * Covers:
 *  - getClientIp — pure header extraction
 *  - verifyTurnstileToken — covers the no-secret shortcut, null-token guard,
 *    successful Cloudflare response, failed response, and network error path.
 *
 * fetch is replaced with a Vitest spy in each test that exercises the network path.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getClientIp, verifyTurnstileToken } from "@/lib/turnstile";

// ─── getClientIp ─────────────────────────────────────────────────────────────

describe("getClientIp", () => {
  test("returns the first IP from x-forwarded-for", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  test("returns the IP when x-forwarded-for has a single value", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  test("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("https://example.com", {
      headers: { "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  test("returns null when neither header is present", () => {
    const req = new Request("https://example.com");
    expect(getClientIp(req)).toBeNull();
  });
});

// ─── verifyTurnstileToken ─────────────────────────────────────────────────────

describe("verifyTurnstileToken", () => {
  beforeEach(() => {
    // Remove the secret key so most tests start from the no-op state
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("succeeds without calling fetch when TURNSTILE_SECRET_KEY is not set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await verifyTurnstileToken("some-token");
    expect(result).toEqual({ success: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("fails immediately when token is null and secret IS set", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const result = await verifyTurnstileToken(null);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/captcha/i);
  });

  test("fails immediately when token is undefined and secret IS set", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const result = await verifyTurnstileToken(undefined);
    expect(result.success).toBe(false);
  });

  test("returns success when Cloudflare responds with { success: true }", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const result = await verifyTurnstileToken("valid-token");
    expect(result).toEqual({ success: true });
  });

  test("returns failure when Cloudflare responds with { success: false }", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
        status: 200,
      })
    );
    const result = await verifyTurnstileToken("bad-token");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("returns failure with a user-friendly message on network error", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network failure"));
    const result = await verifyTurnstileToken("some-token");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/captcha|verify/i);
  });

  test("sends the remoteip parameter when provided", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    await verifyTurnstileToken("tok", "1.2.3.4");
    const body = fetchSpy.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });
});
