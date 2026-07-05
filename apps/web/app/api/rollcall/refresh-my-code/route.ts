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
  const newCode = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  const now = new Date().toISOString();

  // Update own profile row using the authenticated session (RLS: user can update own row)
  const { error } = await supabase
    .from("profiles")
    .update({ daily_access_code: newCode, access_code_generated_at: now, updated_at: now })
    .eq("id", user.id);

  if (error) {
    console.error("[refresh-my-code] Update failed:", error);
    return Response.json({ error: "Failed to refresh code." }, { status: 500 });
  }

  return Response.json({ code: newCode });
}
