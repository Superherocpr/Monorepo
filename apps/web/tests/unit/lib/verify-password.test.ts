/**
 * Unit tests for lib/auth/verify-password.ts
 *
 * This helper is the gate in front of self-service email and password changes,
 * so the cases that matter are the ones where it must NOT return ok:
 *
 *   1. A wrong password, or credentials that resolve to a different account —
 *      the id check is what stops one signed-in user from using their own
 *      password to authorize a change to somebody else's row.
 *   2. A misconfigured anon key. If NEXT_PUBLIC_SUPABASE_ANON_KEY were ever
 *      pointed at a privileged key, signInWithPassword could succeed in ways
 *      the check does not intend, so the helper refuses to run at all and
 *      reports "config" rather than silently passing.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const signInWithPassword = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));

const { getJwtRoleClaim, verifyPassword } = await import("@/lib/auth/verify-password");

/** Builds an unsigned JWT-shaped string carrying the given role claim. */
function jwtWithRole(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `header.${payload}.signature`;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  signInWithPassword.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwtWithRole("anon");
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("getJwtRoleClaim", () => {
  test("extracts the role claim from a JWT-shaped key", () => {
    expect(getJwtRoleClaim(jwtWithRole("anon"))).toBe("anon");
    expect(getJwtRoleClaim(jwtWithRole("service_role"))).toBe("service_role");
  });

  test("returns null for a non-JWT key rather than throwing", () => {
    // Newer Supabase publishable keys are not JWTs; these must not crash the caller.
    expect(getJwtRoleClaim("sb_publishable_abc123")).toBeNull();
    expect(getJwtRoleClaim("")).toBeNull();
  });

  test("returns null when the payload is not decodable JSON", () => {
    expect(getJwtRoleClaim("header.!!!notbase64json!!!.sig")).toBeNull();
  });

  test("returns null when a valid JWT carries no role claim", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "abc" })).toString("base64url");
    expect(getJwtRoleClaim(`header.${payload}.sig`)).toBeNull();
  });
});

describe("verifyPassword", () => {
  test("passes when the password is correct and resolves to the expected user", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    const result = await verifyPassword("staff@example.com", "correct-horse", "user-1", "test");

    expect(result).toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "staff@example.com",
      password: "correct-horse",
    });
  });

  test("fails as invalid when Supabase rejects the credentials", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" },
    });

    const result = await verifyPassword("staff@example.com", "wrong", "user-1", "test");

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  test("fails when valid credentials resolve to a different account", async () => {
    // The password is correct for SOME account, just not the one being edited.
    // Without the id check this would authorize a change to another user's row.
    signInWithPassword.mockResolvedValue({
      data: { user: { id: "someone-else" } },
      error: null,
    });

    const result = await verifyPassword("staff@example.com", "correct-horse", "user-1", "test");

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  test("refuses to run when the anon key is a privileged key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwtWithRole("service_role");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await verifyPassword("staff@example.com", "correct-horse", "user-1", "test");

    expect(result).toEqual({ ok: false, reason: "config" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  test("reports config when Supabase env vars are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await verifyPassword("staff@example.com", "correct-horse", "user-1", "test");

    expect(result).toEqual({ ok: false, reason: "config" });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  test("allows a non-JWT publishable key through the role guard", async () => {
    // getJwtRoleClaim returns null for these; that must not be treated as a
    // privileged key, or password verification would break on newer projects.
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_abc123";
    signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    const result = await verifyPassword("staff@example.com", "correct-horse", "user-1", "test");

    expect(result).toEqual({ ok: true });
  });
});
