/**
 * Unit tests for lib/rate-limit.ts.
 *
 * The limiter guards two public endpoints (rollcall code verification and the
 * booking page's account lookup). What matters: it allows exactly `max`
 * requests per window, keeps refusing a client that keeps trying, lets the
 * window reset, and never lets one client's traffic count against another's.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("allows up to max requests, then refuses", () => {
    const allow = createRateLimiter({ max: 3, windowMs: 60_000 });
    expect([allow("a"), allow("a"), allow("a")]).toEqual([true, true, true]);
    expect(allow("a")).toBe(false);
  });

  test("keeps refusing while the client keeps trying inside the window", () => {
    const allow = createRateLimiter({ max: 1, windowMs: 60_000 });
    allow("a");
    expect(allow("a")).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(allow("a")).toBe(false);
  });

  test("starts a fresh window once the old one has expired", () => {
    const allow = createRateLimiter({ max: 1, windowMs: 60_000 });
    allow("a");
    expect(allow("a")).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(allow("a")).toBe(true);
  });

  test("counts each key separately", () => {
    const allow = createRateLimiter({ max: 1, windowMs: 60_000 });
    allow("a");
    expect(allow("a")).toBe(false);
    expect(allow("b")).toBe(true);
  });

  test("two limiters do not share buckets", () => {
    const first = createRateLimiter({ max: 1, windowMs: 60_000 });
    const second = createRateLimiter({ max: 1, windowMs: 60_000 });
    first("a");
    expect(first("a")).toBe(false);
    expect(second("a")).toBe(true);
  });
});

describe("getClientIp", () => {
  test("uses the first X-Forwarded-For entry", () => {
    const req = new Request("https://x.test", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  test("falls back to X-Real-IP, then to 'unknown'", () => {
    expect(getClientIp(new Request("https://x.test", { headers: { "x-real-ip": "9.9.9.9" } }))).toBe("9.9.9.9");
    expect(getClientIp(new Request("https://x.test"))).toBe("unknown");
  });
});
