/**
 * PATCH /api/staff/[id]/deactivate
 * Called by: Admin Staff Management — Deactivate action (after inline confirmation)
 * Auth: super_admin only
 * Sets deactivated = true on the profile and calls Supabase auth ban to block login.
 * All data (sessions, invoices, grading records) is fully preserved.
 * Owner email is protected — returns 403 if targeted.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { OWNER_EMAILS } from "@/lib/constants";

/**
 * Deactivates a staff member by profile ID.
 * Sets deactivated = true and ban_duration = 'none' on the Supabase auth user.
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

  // ── Owner protection ───────────────────────────────────────────────────────
  const { data: target } = await adminSupabase
    .from("profiles")
    .select("email")
    .eq("id", targetId)
    .single();

  if (!target) {
    return Response.json(
      { success: false, error: "Staff member not found." },
      { status: 404 }
    );
  }

  // Normalize to lowercase — email addresses are case-insensitive per RFC 5321
  if (OWNER_EMAILS.includes(target.email.toLowerCase())) {
    return Response.json(
      { success: false, error: "The owner cannot be deactivated." },
      { status: 403 }
    );
  }

  // ── Mark profile as deactivated ────────────────────────────────────────────
  // Compatibility fallback: some older local schemas may not yet have updated_at.
  const nowIso = new Date().toISOString();
  const updateAttempts = [
    { deactivated: true, deactivated_at: nowIso, updated_at: nowIso },
    { deactivated: true, deactivated_at: nowIso },
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
      { success: false, error: "Failed to deactivate account." },
      { status: 500 }
    );
  }

  // ── Block Supabase auth login ──────────────────────────────────────────────
  // ban_duration: 'none' means an indefinite ban — the user cannot log in

  await adminSupabase.auth.admin.updateUserById(targetId, { ban_duration: "none" });

  return Response.json({ success: true });
}
