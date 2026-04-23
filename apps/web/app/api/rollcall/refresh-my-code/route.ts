/**
 * POST /api/rollcall/refresh-my-code
 * Called by: InstructorDashboard "Refresh Code" button
 * Auth: Supabase session required — instructor role only
 * Generates a new 6-digit daily access code for the authenticated instructor.
 * Used for manual refresh (e.g., instructor displayed the code on a projector
 * and wants a new one, or testing during development).
 */

import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * Regenerates the calling instructor's daily_access_code and returns the new value.
 * @param _request - No body required
 */
export async function POST(_request: Request) {
  // ── Verify the caller is an authenticated instructor ──────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, deactivated")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "instructor" || profile.deactivated) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  // ── Generate and persist the new code ────────────────────────────────────
  const newCode = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  const now = new Date().toISOString();

  const adminSupabase = await createAdminClient();

  const { error } = await adminSupabase
    .from("profiles")
    .update({ daily_access_code: newCode, access_code_generated_at: now, updated_at: now })
    .eq("id", user.id);

  if (error) {
    console.error("[refresh-my-code] Update failed:", error);
    return Response.json({ error: "Failed to refresh code." }, { status: 500 });
  }

  return Response.json({ code: newCode });
}
