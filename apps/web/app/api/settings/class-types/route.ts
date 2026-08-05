/**
 * POST /api/settings/class-types
 * Called by: Admin Settings — Add Class Type panel
 * Auth: super_admin only
 * Creates a new class_types record.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/**
 * Creates a new class type record.
 * @param request - POST body: { name, description?, duration_minutes, max_capacity, price, active, cert_type_id?, addon_ids? }
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

  const adminClient = await createAdminClient();

  // ── Parse and validate body ────────────────────────────────────────────────
  const body = await request.json();
  const { name, description, duration_minutes, max_capacity, price, active, is_aha, cert_type_id, addon_ids } =
    body as {
      name: string;
      description: string | null;
      duration_minutes: number;
      max_capacity: number;
      price: number;
      active: boolean;
      is_aha?: boolean;
      cert_type_id?: string | null;
      addon_ids?: string[];
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
  const { data: classType, error } = await adminClient
    .from("class_types")
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      duration_minutes,
      max_capacity,
      price,
      active: active !== false,
      is_aha: is_aha === true,
      cert_type_id: cert_type_id || null,
    })
    .select("id")
    .single();

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

  // ── Assign eligible add-ons ─────────────────────────────────────────────────
  if (addon_ids && addon_ids.length > 0) {
    const { error: addonError } = await adminClient
      .from("addon_class_types")
      .insert(addon_ids.map((addon_id) => ({ addon_id, class_type_id: classType.id })));

    if (addonError) {
      console.error("[POST /api/settings/class-types] addon assignment", addonError);
      return Response.json(
        { success: false, error: "Class type created, but failed to assign add-ons." },
        { status: 500 }
      );
    }
  }

  return Response.json({ success: true });
}
