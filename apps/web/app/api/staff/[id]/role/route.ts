/**
 * PATCH /api/staff/[id]/role
 * Called by: Admin Staff Management — Change Role action
 * Auth: super_admin only
 * Updates the target staff member's role.
 * Protected: owner email cannot be changed. Self-demotion is blocked.
 */

import { createClient } from "@/lib/supabase/server";
import { OWNER_EMAILS } from "@/lib/constants";

/**
 * Updates the role of a staff member by profile ID.
 * Blocks changes to the owner email and prevents the caller from changing their own role.
 * @param request - PATCH body: { role: string }
 * @param params - Route params containing the target staff member's profile ID.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  // ── Self-demotion prevention ───────────────────────────────────────────────
  if (user.id === targetId) {
    return Response.json(
      { success: false, error: "You cannot change your own role." },
      { status: 400 }
    );
  }

  // ── Parse and validate role ────────────────────────────────────────────────
  const body = await request.json();
  const { role: newRole } = body as { role: string };

  const allowedRoles = ["instructor", "manager", "super_admin", "inspector"];
  if (!allowedRoles.includes(newRole)) {
    return Response.json({ success: false, error: "Invalid role." }, { status: 400 });
  }

  // ── Owner protection — fetch target email ──────────────────────────────────
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
  if (OWNER_EMAILS.includes(target.email.toLowerCase())) {
    return Response.json(
      { success: false, error: "The owner's role cannot be changed." },
      { status: 403 }
    );
  }

  // ── Update role ────────────────────────────────────────────────────────────
  // Compatibility fallback: some older local schemas may not yet have updated_at.
  const nowIso = new Date().toISOString();
  const updateAttempts = [{ role: newRole, updated_at: nowIso }, { role: newRole }];

  let updateError: { message?: string } | null = null;
  for (const payload of updateAttempts) {
    const { error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", targetId);
    if (!error) {
      updateError = null;
      break;
    }
    updateError = error;
  }

  if (updateError) {
    return Response.json(
      { success: false, error: "Failed to update role." },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
