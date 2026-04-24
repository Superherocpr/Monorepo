/**
 * POST /api/settings/class-types
 * Called by: Admin Settings — Add Class Type panel
 * Auth: super_admin only
 * Creates a new class_types record.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/**
 * Creates a new class type record.
 * @param request - POST body: { name, description?, duration_minutes, max_capacity, price, active }
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
  const { name, description, duration_minutes, max_capacity, price, active } =
    body as {
      name: string;
      description: string | null;
      duration_minutes: number;
      max_capacity: number;
      price: number;
      active: boolean;
    };

  if (
    !name?.trim() ||
    typeof duration_minutes !== "number" ||
    duration_minutes <= 0 ||
    typeof max_capacity !== "number" ||
    max_capacity <= 0 ||
    typeof price !== "number" ||
    price < 0
  ) {
    return Response.json(
      { success: false, error: "Missing or invalid required fields." },
      { status: 400 }
    );
  }

  // ── Insert ─────────────────────────────────────────────────────────────────
  const { error } = await supabase.from("class_types").insert({
    name: name.trim(),
    description: description?.trim() || null,
    duration_minutes,
    max_capacity,
    price,
    active: active !== false,
  });

  if (error) {
    // Unique constraint on name
    if (error.code === "23505") {
      return Response.json(
        { success: false, error: "A class type with this name already exists." },
        { status: 409 }
      );
    }
    return Response.json({ success: false, error: "Failed to create class type." }, { status: 500 });
  }

  return Response.json({ success: true });
}
