/**
 * POST /api/rollcall/refresh-my-code
 * Called by: InstructorDashboard "Refresh Code" button
 * Auth: Supabase session required — instructor or super_admin role only
 * Generates a new 6-digit daily access code for the authenticated instructor.
 * Used for manual refresh (e.g., instructor displayed the code on a projector
 * and wants a new one, or testing during development).
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Regenerates the calling instructor's daily_access_code and returns the new value.
 * Uses the authenticated user's own session — no service role needed since the
 * user is updating their own profile row.
 * @param _request - No body required
 */
export async function POST(_request: Request) {
  const supabase = await createClient();

  // ── Verify the caller is an authenticated instructor or super_admin ────────
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

  // Null check must come before accessing profile fields
  if (!profile) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }

  // super_admins are also instructors and may need to refresh their code
  const isInstructor = profile.role === "instructor" || profile.role === "super_admin";
  if (!isInstructor || profile.deactivated) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

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
