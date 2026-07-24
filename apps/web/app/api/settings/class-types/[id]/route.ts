/**
 * PATCH /api/settings/class-types/[id]
 * Called by: Admin Settings — Edit Class Type panel
 * Auth: super_admin only
 * Updates an existing class_types record.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/**
 * Updates a class type by ID. All editable fields may be provided.
 * @param request - PATCH body: { name, description?, duration_minutes, max_capacity, price, active, cert_type_id?, addon_ids? }
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

  const adminClient = await createAdminClient();

  // ── Parse and validate body ────────────────────────────────────────────────
  const body = await request.json();
  const { name, description, duration_minutes, max_capacity, price, active, cert_type_id, addon_ids } =
    body as {
      name: string;
      description: string | null;
      duration_minutes: number;
      max_capacity: number;
      price: number;
      active: boolean;
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

  // ── Update ─────────────────────────────────────────────────────────────────
  const { error } = await adminClient
    .from("class_types")
    .update({
      name: name.trim(),
      description: description?.trim() || null,
      duration_minutes,
      max_capacity,
      price,
      active,
      cert_type_id: cert_type_id || null,
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

  // ── Sync eligible add-ons ───────────────────────────────────────────────────
  // Replace-all: delete existing assignments then insert the submitted set.
  // Simpler and safer than diffing, and this list is always small.
  const { error: clearError } = await adminClient
    .from("addon_class_types")
    .delete()
    .eq("class_type_id", id);

  if (clearError) {
    console.error("[PATCH /api/settings/class-types/[id]] addon clear", clearError);
    return Response.json(
      { success: false, error: "Class type updated, but failed to sync add-ons." },
      { status: 500 }
    );
  }

  if (addon_ids && addon_ids.length > 0) {
    const { error: addonError } = await adminClient
      .from("addon_class_types")
      .insert(addon_ids.map((addon_id) => ({ addon_id, class_type_id: id })));

    if (addonError) {
      console.error("[PATCH /api/settings/class-types/[id]] addon assignment", addonError);
      return Response.json(
        { success: false, error: "Class type updated, but failed to sync add-ons." },
        { status: 500 }
      );
    }
  }

  return Response.json({ success: true });
}

/**
 * DELETE /api/settings/class-types/[id]
 * Called by: Admin Settings — Class Types section delete button
 * Auth: super_admin only
 * Deletes a class type only if no class sessions reference it.
 * @param _request - Unused.
 * @param params - Route params containing the class type UUID.
 */
export async function DELETE(
  _request: Request,
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

  const adminClient = await createAdminClient();

  // ── Verify no linked sessions ──────────────────────────────────────────────
  const { count, error: countError } = await adminClient
    .from("class_sessions")
    .select("id", { count: "exact", head: true })
    .eq("class_type_id", id);

  if (countError) {
    console.error("[DELETE /api/settings/class-types/[id]] count check", countError);
    return Response.json(
      { success: false, error: "Failed to verify class type usage." },
      { status: 500 }
    );
  }

  if ((count ?? 0) > 0) {
    return Response.json(
      {
        success: false,
        error: `This class type is used in ${count} session${count !== 1 ? "s" : ""} and cannot be deleted.`,
      },
      { status: 409 }
    );
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  const { error } = await adminClient.from("class_types").delete().eq("id", id);

  if (error) {
    console.error("[DELETE /api/settings/class-types/[id]]", error);
    return Response.json(
      { success: false, error: "Failed to delete class type." },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
