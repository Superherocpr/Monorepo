/**
 * POST /api/rollcall/refresh-my-code
 * Called by: InstructorDashboard "Refresh Code" button
 * Auth: Supabase session required — instructor or super_admin role only
 * Generates a new 6-digit daily access code for the authenticated instructor.
 * Used for manual refresh (e.g., instructor displayed the code on a projector
 * and wants a new one, or testing during development).
 */

import { createClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { assignFreshAccessCode } from "@/lib/access-code";

/**
 * Regenerates the calling instructor's daily_access_code and returns the new value.
 * Uses the authenticated user's own session — no service role needed since the
 * user is updating their own profile row.
 * @param _request - No body required
 */
export async function POST(_request: Request) {
  // ── Verify the caller is an authenticated instructor or super_admin ────────
  // super_admins are also instructors and may need to refresh their code.
  // Honors view-as (deactivated check happens inside requireApiRole).
  const authResult = await requireApiRole(["instructor", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const user = authResult.actor.user;

  const supabase = await createClient();

  // ── Generate and persist the new code ────────────────────────────────────
  // Shared helper: crypto-random code, retries on unique-index collision.
  // Updates own profile row using the authenticated session (RLS: own row).
  const { data, error } = await assignFreshAccessCode(supabase, user.id);

  if (data === null) {
    console.error("[refresh-my-code] Update failed:", error);
    return Response.json({ error: "Failed to refresh code." }, { status: 500 });
  }

  return Response.json({ code: data.code });
}
