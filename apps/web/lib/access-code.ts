/**
 * access-code.ts — rollcall access-code generation.
 *
 * Single source of truth for creating an instructor's 6-digit rollcall code.
 * Used by the admin dashboard (auto-refresh on load) and
 * /api/rollcall/refresh-my-code (manual refresh button).
 *
 * Codes are unique across instructors (enforced by the partial unique index
 * profiles_daily_access_code_unique, migration 0034). On a collision the
 * update fails with Postgres error 23505 and we retry with a new code —
 * without this, two instructors sharing a code would break rollcall for both.
 */

import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Postgres unique-violation error code. */
const UNIQUE_VIOLATION = "23505";

/** How many collision retries before giving up (collisions are ~1e-6 each). */
const MAX_ATTEMPTS = 5;

/**
 * Generates a cryptographically random 6-digit code, zero-padded.
 * crypto.randomInt over Math.random — this is a security code, however
 * short-lived, and must not come from a predictable PRNG.
 */
export function generateAccessCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Assigns a fresh access code to the given profile, retrying on the (rare)
 * unique-index collision with another instructor's live code.
 *
 * Side effect: updates profiles.daily_access_code, access_code_generated_at,
 * and updated_at for `userId`.
 *
 * @param supabase - any Supabase client allowed to update the row (the
 *   user's own authenticated client under RLS, or the admin client)
 * @param userId - profile id to assign the code to
 * @returns { data: { code, generatedAt }, error: null } on success,
 *          { data: null, error } after MAX_ATTEMPTS failures or a
 *          non-collision DB error.
 */
export async function assignFreshAccessCode(
  supabase: SupabaseClient,
  userId: string
): Promise<
  | { data: { code: string; generatedAt: string }; error: null }
  | { data: null; error: string }
> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const code = generateAccessCode();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("profiles")
      .update({
        daily_access_code: code,
        access_code_generated_at: now,
        updated_at: now,
      })
      .eq("id", userId);

    if (!error) return { data: { code, generatedAt: now }, error: null };

    // Another instructor holds this code right now — try a different one
    if (error.code === UNIQUE_VIOLATION) continue;

    return { data: null, error: error.message };
  }

  return {
    data: null,
    error: `Could not find a free access code after ${MAX_ATTEMPTS} attempts.`,
  };
}
