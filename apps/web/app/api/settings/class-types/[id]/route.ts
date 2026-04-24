/**
 * PATCH /api/settings/class-types/[id]
 * Called by: Admin Settings — Edit Class Type panel
 * Auth: super_admin only
 * Updates an existing class_types record.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/**
 * Updates a class type by ID. All editable fields may be provided.
 * @param request - PATCH body: { name, description?, duration_minutes, max_capacity, price, active }
 * @param params - Route params containing the class type UUID.
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

  // ── Update ─────────────────────────────────────────────────────────────────
  const { error } = await supabase
    .from("class_types")
    .update({
      name: name.trim(),
      description: description?.trim() || null,
      duration_minutes,
      max_capacity,
      price,
      active,
    })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { success: false, error: "A class type with this name already exists." },
        { status: 409 }
      );
    }
    return Response.json({ success: false, error: "Failed to update class type." }, { status: 500 });
  }

  return Response.json({ success: true });
}
