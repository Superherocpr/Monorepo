/**
 * PATCH /api/settings/class-types/[id]/toggle-active
 * Called by: Admin Settings — Activate/Deactivate class type button
 * Auth: super_admin only
 * Flips the active boolean on the class_types record.
 * Returns the new active value so the client can update optimistically.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/**
 * Toggles the active field on a class type by ID.
 * Reads the current value, flips it, and persists.
 * @param request - No body required.
 * @param params - Route params containing the class type UUID.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  void request;
  const { id } = await params;
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || (actor.role as UserRole) !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Read current active state ──────────────────────────────────────────────
  const { data: current } = await supabase
    .from("class_types")
    .select("active")
    .eq("id", id)
    .single();

  if (!current) {
    return Response.json({ success: false, error: "Class type not found." }, { status: 404 });
  }

  const newActive = !current.active;

  // ── Update ─────────────────────────────────────────────────────────────────
  const { error } = await supabase
    .from("class_types")
    .update({ active: newActive })
    .eq("id", id);

  if (error) {
    return Response.json(
      { success: false, error: "Failed to update class type." },
      { status: 500 }
    );
  }

  return Response.json({ success: true, active: newActive });
}
