/**
 * PATCH/DELETE /api/settings/addons/[id]
 * Called by: Admin Settings — Class Types tab, Add-ons section
 * Auth: super_admin only
 * PATCH updates an addon record. DELETE removes it (only if unused by any class type).
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/**
 * Updates an add-on by ID. All editable fields may be provided.
 * @param request - PATCH body: { name, description?, price, active }
 * @param params - Route params containing the addon UUID.
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
  const { name, description, price, active } = body as {
    name: string;
    description: string | null;
    price: number;
    active: boolean;
  };

  if (!name?.trim() || typeof price !== "number" || price < 0) {
    return Response.json(
      { success: false, error: "Missing or invalid required fields." },
      { status: 400 }
    );
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  const { error } = await adminClient
    .from("addons")
    .update({
      name: name.trim(),
      description: description?.trim() || null,
      price,
      active,
    })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { success: false, error: "An add-on with this name already exists." },
        { status: 409 }
      );
    }
    console.error("[PATCH /api/settings/addons/[id]]", error);
    return Response.json({ success: false, error: "Failed to update add-on." }, { status: 500 });
  }

  return Response.json({ success: true });
}

/**
 * Deletes an add-on by ID, but only if no class type currently has it assigned.
 * @param _request - Unused.
 * @param params - Route params containing the addon UUID.
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

  // ── Verify no linked class types ────────────────────────────────────────────
  const { count, error: countError } = await adminClient
    .from("addon_class_types")
    .select("id", { count: "exact", head: true })
    .eq("addon_id", id);

  if (countError) {
    console.error("[DELETE /api/settings/addons/[id]] count check", countError);
    return Response.json(
      { success: false, error: "Failed to verify add-on usage." },
      { status: 500 }
    );
  }

  if ((count ?? 0) > 0) {
    return Response.json(
      {
        success: false,
        error: `This add-on is assigned to ${count} class type${count !== 1 ? "s" : ""}. Remove it from those first.`,
      },
      { status: 409 }
    );
  }

  // ── Verify no purchase history ───────────────────────────────────────────────
  // booking_addons.addon_id is ON DELETE RESTRICT (migration 0037) — it's a
  // financial record, so this check gives a friendly error instead of a raw
  // DB constraint violation.
  const { count: purchaseCount, error: purchaseCountError } = await adminClient
    .from("booking_addons")
    .select("id", { count: "exact", head: true })
    .eq("addon_id", id);

  if (purchaseCountError) {
    console.error("[DELETE /api/settings/addons/[id]] purchase count check", purchaseCountError);
    return Response.json(
      { success: false, error: "Failed to verify add-on usage." },
      { status: 500 }
    );
  }

  if ((purchaseCount ?? 0) > 0) {
    return Response.json(
      {
        success: false,
        error: `This add-on has been purchased with ${purchaseCount} booking${purchaseCount !== 1 ? "s" : ""} and cannot be deleted. Deactivate it instead.`,
      },
      { status: 409 }
    );
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  const { error } = await adminClient.from("addons").delete().eq("id", id);

  if (error) {
    console.error("[DELETE /api/settings/addons/[id]]", error);
    return Response.json({ success: false, error: "Failed to delete add-on." }, { status: 500 });
  }

  return Response.json({ success: true });
}
