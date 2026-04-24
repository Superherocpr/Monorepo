/**
 * PATCH /api/staff/[id]/deactivate
 * Called by: Admin Staff Management — Deactivate action (after inline confirmation)
 * Auth: super_admin only
 * Sets deactivated = true on the profile and calls Supabase auth ban to block login.
 * All data (sessions, invoices, grading records) is fully preserved.
 * Owner email is protected — returns 403 if targeted.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { OWNER_EMAIL } from "@/lib/constants";

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

  // ── Owner protection ───────────────────────────────────────────────────────
  const { data: target } = await supabase
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
  if (target.email.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
    return Response.json(
      { success: false, error: "The owner cannot be deactivated." },
      { status: 403 }
    );
  }

  // ── Mark profile as deactivated ────────────────────────────────────────────
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      deactivated: true,
      deactivated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetId);

  if (profileError) {
    return Response.json(
      { success: false, error: "Failed to deactivate account." },
      { status: 500 }
    );
  }

  // ── Block Supabase auth login ──────────────────────────────────────────────
  // ban_duration: 'none' means an indefinite ban — the user cannot log in
  const adminSupabase = await createAdminClient();
  await adminSupabase.auth.admin.updateUserById(targetId, { ban_duration: "none" });

  return Response.json({ success: true });
}
