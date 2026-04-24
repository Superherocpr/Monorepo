/**
 * PATCH /api/staff/[id]/reactivate
 * Called by: Admin Staff Management — Reactivate action (one-click, no confirmation)
 * Auth: super_admin only
 * Sets deactivated = false on the profile and lifts the Supabase auth ban.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";

/**
 * Reactivates a deactivated staff member by profile ID.
 * Clears deactivated flag and calls ban_duration = '0' to restore Supabase auth login.
 * @param request - No body required.
 * @param params - Route params containing the target staff member's profile ID.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  void request;
  const { id: targetId } = await params;
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || actor.role !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Clear deactivated flag ─────────────────────────────────────────────────
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      deactivated: false,
      deactivated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetId);

  if (profileError) {
    return Response.json(
      { success: false, error: "Failed to reactivate account." },
      { status: 500 }
    );
  }

  // ── Restore Supabase auth login ────────────────────────────────────────────
  // ban_duration: '0' lifts any active ban — the user can log in again
  const adminSupabase = await createAdminClient();
  await adminSupabase.auth.admin.updateUser(targetId, { ban_duration: "0" });

  return Response.json({ success: true });
}
