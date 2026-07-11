/**
 * PATCH /api/staff/[id]/reactivate
 * Called by: Admin Staff Management — Reactivate action (one-click, no confirmation)
 * Auth: super_admin only
 * Sets deactivated = false on the profile and lifts the Supabase auth ban.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

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

  // ── Auth & role check ──────────────────────────────────────────────────────
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminSupabase = await createAdminClient();

  // ── Clear deactivated flag ─────────────────────────────────────────────────
  // Compatibility fallback: some older local schemas may not yet have updated_at.
  const nowIso = new Date().toISOString();
  const updateAttempts = [
    { deactivated: false, deactivated_at: null, updated_at: nowIso },
    { deactivated: false, deactivated_at: null },
  ];

  let profileError: { message?: string } | null = null;
  for (const payload of updateAttempts) {
    const { error } = await adminSupabase
      .from("profiles")
      .update(payload)
      .eq("id", targetId);
    if (!error) {
      profileError = null;
      break;
    }
    profileError = error;
  }

  if (profileError) {
    return Response.json(
      { success: false, error: "Failed to reactivate account." },
      { status: 500 }
    );
  }

  // ── Restore Supabase auth login ────────────────────────────────────────────
  // ban_duration: '0' lifts any active ban — the user can log in again

  await adminSupabase.auth.admin.updateUserById(targetId, { ban_duration: "0" });

  return Response.json({ success: true });
}
