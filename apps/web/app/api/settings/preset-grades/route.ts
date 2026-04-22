/**
 * POST /api/settings/preset-grades
 * Called by: Admin Settings — Add Grade inline row
 * Auth: super_admin only
 * Creates a new preset_grades record. Rejects duplicate values.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/**
 * Creates a new preset grade.
 * Returns the created record so the client can add it to local state.
 * @param request - POST body: { value: number, label: string }
 */
export async function POST(request: Request) {
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

  // ── Insert ─────────────────────────────────────────────────────────────────
  const { data: grade, error } = await supabase
    .from("preset_grades")
    .insert({ value, label: label.trim() })
    .select("id, value, label")
    .single();

  if (error) {
    // Unique constraint on value
    if (error.code === "23505") {
      return Response.json(
        { success: false, error: `A grade with value ${value} already exists.` },
        { status: 409 }
      );
    }
    return Response.json({ success: false, error: "Failed to create grade." }, { status: 500 });
  }

  return Response.json({ success: true, grade });
}
