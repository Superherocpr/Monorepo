/**
 * Shared current-password verification for self-service account changes.
 *
 * Any route that lets a user change something sensitive about their own account
 * (login email, password) must first prove the person at the keyboard knows the
 * current password — a live session cookie alone is not enough, since a borrowed
 * or hijacked session would otherwise be able to lock the real owner out by
 * changing both their login address and password.
 *
 * Why a fresh plain client rather than the SSR cookie client: the SSR client's
 * session-management machinery can swallow auth errors inside Route Handlers,
 * making a wrong password look like a success. A throwaway anon client returns a
 * clean pass/fail. persistSession is off because there is no browser to persist to.
 *
 * Used by: app/api/profile/self-update, app/api/rollcall/checkin-by-profile.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Outcome of a password check. `config` means the server is misconfigured, not that the password was wrong. */
export type VerifyPasswordResult =
  | { ok: true }
  | { ok: false; reason: "config" | "invalid" };

/**
 * Extracts the JWT role claim from a Supabase API key when it is in JWT format.
 * Returns null for non-JWT keys (for example, newer publishable key formats).
 * @param key - Supabase API key string.
 * @returns The `role` claim, or null when the key is not a decodable JWT.
 */
export function getJwtRoleClaim(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      role?: string;
    };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

/**
 * Verifies a password against a specific account by attempting a sign-in.
 *
 * Guards against a misconfigured anon key: if NEXT_PUBLIC_SUPABASE_ANON_KEY has
 * elevated privileges, sign-in is refused outright rather than run with a key
 * that could bypass the check.
 *
 * @param email - The account's CURRENT stored email (never a client-supplied new one).
 * @param password - The password to test.
 * @param expectedUserId - The profile id the credentials must resolve to; a mismatch fails.
 * @param logPrefix - Tag used for server-side error logs, e.g. "profile/self-update".
 * @returns `{ ok: true }` when the password is correct and maps to expectedUserId.
 */
export async function verifyPassword(
  email: string,
  password: string,
  expectedUserId: string,
  logPrefix: string
): Promise<VerifyPasswordResult> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!anonKey || !supabaseUrl) {
    console.error(`[${logPrefix}] Missing Supabase env vars for password verification.`);
    return { ok: false, reason: "config" };
  }

  const keyRole = getJwtRoleClaim(anonKey);
  if (keyRole && keyRole !== "anon") {
    console.error(
      `[${logPrefix}] Refusing password verification because NEXT_PUBLIC_SUPABASE_ANON_KEY role is '${keyRole}', expected 'anon'.`
    );
    return { ok: false, reason: "config" };
  }

  const anonClient = createSupabaseClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await anonClient.auth.signInWithPassword({ email, password });

  // Require both: no auth error, and a user whose id matches the target account.
  if (error || !data.user || data.user.id !== expectedUserId) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true };
}
