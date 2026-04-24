/**
 * PATCH /api/settings/preset-grades/[id]
 * Called by: Admin Settings — Inline grade edit (save on blur or Enter)
 * Auth: super_admin only
 * Updates a preset grade's value and/or label. Rejects duplicate values.
 *
 * DELETE /api/settings/preset-grades/[id]
 * Called by: Admin Settings — Delete grade button
 * Auth: super_admin only
 * Deletes a preset grade only if no roster_records reference this grade value.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/**
 * Updates a preset grade by ID.
 * @param request - PATCH body: { value: number, label: string }
 * @param params - Route params containing the grade UUID.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  // ── Parse and validate body ────────────────────────────────────────────────
  const body = await request.json();
  const { value, label } = body as { value: number; label: string };

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    return Response.json(
      { success: false, error: "Value must be an integer between 0 and 100." },
      { status: 400 }
    );
  }
  if (!label?.trim()) {
    return Response.json({ success: false, error: "Label is required." }, { status: 400 });
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  const { error } = await supabase
    .from("preset_grades")
    .update({ value, label: label.trim() })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { success: false, error: `A grade with value ${value} already exists.` },
        { status: 409 }
      );
    }
    return Response.json({ success: false, error: "Failed to update grade." }, { status: 500 });
  }

  return Response.json({ success: true });
}

/**
 * Deletes a preset grade by ID.
 * Blocked if any roster_records rows reference this grade's value.
 * @param request - No body required.
 * @param params - Route params containing the grade UUID.
 */
export async function DELETE(
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

  // ── Fetch the grade to get its value for the roster check ──────────────────
  const { data: grade } = await supabase
    .from("preset_grades")
    .select("value")
    .eq("id", id)
    .single();

  if (!grade) {
    return Response.json({ success: false, error: "Grade not found." }, { status: 404 });
  }

  // ── Block deletion if any roster records use this grade value ──────────────
  const { count } = await supabase
    .from("roster_records")
    .select("id", { count: "exact", head: true })
    .eq("grade", grade.value);

  if (count && count > 0) {
    return Response.json(
      {
        success: false,
        error: "This grade is in use and cannot be deleted.",
      },
      { status: 409 }
    );
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  const { error } = await supabase.from("preset_grades").delete().eq("id", id);

  if (error) {
    return Response.json({ success: false, error: "Failed to delete grade." }, { status: 500 });
  }

  return Response.json({ success: true });
}
