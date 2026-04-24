/**
 * DELETE /api/settings/zoho/disconnect
 * Called by: Admin Settings — Disconnect Zoho Mail button
 * Auth: super_admin only
 * Clears all Zoho tokens and account data from system_settings.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/** The system_settings keys that hold Zoho credentials. */
const ZOHO_KEYS = [
  "zoho_access_token",
  "zoho_refresh_token",
  "zoho_account_id",
  "zoho_token_expires_at",
  "zoho_connected_email",
];

/**
 * Disconnects Zoho Mail by deleting all Zoho-related keys from system_settings.
 * @param request - No body required.
 */
export async function DELETE(request: Request) {
  void request;
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

  // ── Delete all Zoho keys — admin client bypasses RLS on system_settings ────
  const adminSupabase = await createAdminClient();
  const { error } = await adminSupabase
    .from("system_settings")
    .delete()
    .in("key", ZOHO_KEYS);

  if (error) {
    return Response.json(
      { success: false, error: "Failed to disconnect Zoho." },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
