/**
 * Unit tests for POST /api/bookings/check-existing-customer.
 *
 * The booking page asks this route whether an email or phone already has an
 * account. It replaced browser-side queries that only worked because the
 * profiles table was readable by anyone holding the public API key. What
 * matters: it answers yes/no and nothing else (never a profile), matches email
 * before phone, keeps the old "a phone shared by several profiles is no match"
 * rule, rejects malformed input before touching the database, reports a
 * database failure as an error instead of a false "no account", and is rate
 * limited.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/bookings/check-existing-customer/route";

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/server";

type QueryResult = { data: { id: string }[] | null; error: { message: string } | null };

const eqCalls: Array<[string, string]> = [];
const selectCalls: string[] = [];

/** Stubs admin.from("profiles") to answer the email query, then the phone query. */
function stubProfiles(emailResult: QueryResult, phoneResult?: QueryResult): void {
  const results = [emailResult, phoneResult ?? { data: [], error: null }];
  let call = 0;
  vi.mocked(createAdminClient).mockResolvedValue({
    from: () => ({
      select: (cols: string) => {
        selectCalls.push(cols);
        return {
          eq: (col: string, val: string) => {
            eqCalls.push([col, val]);
            // Cycles email, phone, email, phone... so a loop of requests keeps getting answers.
            return { limit: () => Promise.resolve(results[call++ % 2]) };
          },
        };
      },
    }),
  } as never);
}

let ipCounter = 0;
/** Each request gets its own IP so the module-level rate limiter never leaks between tests. */
function req(body: unknown, ip = `10.0.0.${++ipCounter}`): Request {
  return new Request("https://superherocpr.com/api/bookings/check-existing-customer", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = { email: "  Jane@Example.com ", phone: " 555-0100 " };

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  selectCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/bookings/check-existing-customer", () => {
  test("reports an existing account when exactly one profile has the email", async () => {
    stubProfiles({ data: [{ id: "u1" }], error: null });
    const res = await POST(req(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { exists: true }, error: null });
  });

  test("normalises the email (trim, lowercase) and trims the phone before matching", async () => {
    stubProfiles({ data: [{ id: "u1" }], error: null });
    await POST(req(valid));
    expect(eqCalls[0]).toEqual(["email", "jane@example.com"]);
  });

  test("falls back to the phone when the email matches nothing", async () => {
    stubProfiles({ data: [], error: null }, { data: [{ id: "u2" }], error: null });
    const res = await POST(req(valid));
    expect(await res.json()).toEqual({ data: { exists: true }, error: null });
    expect(eqCalls).toEqual([
      ["email", "jane@example.com"],
      ["phone", "555-0100"],
    ]);
  });

  test("reports no account when neither email nor phone matches", async () => {
    stubProfiles({ data: [], error: null }, { data: [], error: null });
    const res = await POST(req(valid));
    expect(await res.json()).toEqual({ data: { exists: false }, error: null });
  });

  test("a phone shared by several profiles is not treated as a match", async () => {
    stubProfiles({ data: [], error: null }, { data: [{ id: "a" }, { id: "b" }], error: null });
    const res = await POST(req(valid));
    expect(await res.json()).toEqual({ data: { exists: false }, error: null });
  });

  test("selects only the id column and never returns any profile data", async () => {
    stubProfiles({ data: [{ id: "u1" }], error: null });
    const res = await POST(req(valid));
    expect(new Set(selectCalls)).toEqual(new Set(["id"]));
    expect(Object.keys((await res.json()).data)).toEqual(["exists"]);
  });

  test.each([
    ["missing email", { phone: "555" }],
    ["missing phone", { email: "a@b.co" }],
    ["malformed email", { email: "not-an-email", phone: "555" }],
    ["blank phone", { email: "a@b.co", phone: "   " }],
    ["email over 254 characters", { email: `${"a".repeat(250)}@b.co`, phone: "555" }],
    ["phone over 40 characters", { email: "a@b.co", phone: "5".repeat(41) }],
    ["non-string email", { email: 5, phone: "555" }],
  ])("rejects %s without querying the database", async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  test("rejects a body that is not JSON", async () => {
    const res = await POST(req("{not json"));
    expect(res.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  test("a database failure is an error, never a false 'no account'", async () => {
    stubProfiles({ data: null, error: { message: 'relation "profiles" is on fire' } });
    const res = await POST(req(valid));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ data: null, error: "Lookup failed." });
    expect(JSON.stringify(body)).not.toContain("fire");
  });

  test("a phone-query failure is also an error", async () => {
    stubProfiles({ data: [], error: null }, { data: null, error: { message: "nope" } });
    const res = await POST(req(valid));
    expect(res.status).toBe(500);
  });

  test("refuses with 429 once an IP exceeds 30 lookups an hour, without querying", async () => {
    stubProfiles({ data: [], error: null });
    const ip = "203.0.113.50";
    for (let i = 0; i < 30; i++) {
      expect((await POST(req(valid, ip))).status).toBe(200);
    }
    vi.mocked(createAdminClient).mockClear();
    const res = await POST(req(valid, ip));
    expect(res.status).toBe(429);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
