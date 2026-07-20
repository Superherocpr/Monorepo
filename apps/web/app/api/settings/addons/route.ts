/**
 * GET/POST /api/settings/addons
 * Called by: Admin Settings — Class Types tab, Add-ons section
 * Auth: super_admin only
 * GET lists the full add-on catalog. POST creates a new addon record.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/**
 * Lists all add-ons in the catalog, ordered by name.
 */
export async function GET() {
  const supabase = await createClient();

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

  const { data: addons, error } = await adminClient
    .from("addons")
    .select("id, name, description, price, active, created_at")
    .order("name");

  if (error) {
    console.error("[GET /api/settings/addons]", error);
    return Response.json({ success: false, error: "Failed to load add-ons." }, { status: 500 });
  }

  return Response.json({ success: true, addons });
}

/**
 * Creates a new add-on record.
 * @param request - POST body: { name, description?, price, active }
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

  // ── Insert ─────────────────────────────────────────────────────────────────
  const { data: addon, error } = await adminClient
    .from("addons")
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      price,
      active: active !== false,
    })
    .select("id, name, description, price, active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return Response.json(
        { success: false, error: "An add-on with this name already exists." },
        { status: 409 }
      );
    }
    console.error("[POST /api/settings/addons]", error);
    return Response.json({ success: false, error: "Failed to create add-on." }, { status: 500 });
  }

  return Response.json({ success: true, addon });
}
