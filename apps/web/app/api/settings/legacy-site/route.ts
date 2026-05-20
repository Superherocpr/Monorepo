/**
 * POST /api/settings/legacy-site
 * Called by: Admin Settings — Legacy Site toggle (SettingsClient.tsx)
 * Auth: super_admin only
 *
 * Writes the boolean flag "legacy_site_enabled" to system_settings. When true,
 * the public home page (/) renders the classic SuperheroCPR clone instead of
 * the modern home page. Persisted server-side so the toggle affects every
 * visitor immediately.
 */

import { createClient } from "@/lib/supabase/server";
import { updateSetting } from "@/lib/zoho";
import type { UserRole } from "@/types/users";

/**
 * Sets the legacy_site_enabled system setting.
 * Expects JSON body: { enabled: boolean }
 * Returns: { success: true, enabled: boolean } on success.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || (actor.role as UserRole) !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Validate body ──────────────────────────────────────────────────────────
  const body = await request.json().catch(() => null);
  if (!body || typeof (body as { enabled?: unknown }).enabled !== "boolean") {
    return Response.json(
      { success: false, error: "Missing or invalid `enabled` boolean." },
      { status: 400 }
    );
  }

  const enabled = (body as { enabled: boolean }).enabled;

  // ── Persist to system_settings ─────────────────────────────────────────────
  try {
    // Stored as the string "true" or "false" — matches the existing system_settings text column convention
    await updateSetting("legacy_site_enabled", enabled ? "true" : "false");
  } catch (err) {
    console.error("[/api/settings/legacy-site] updateSetting failed:", err);
    return Response.json(
      { success: false, error: "Failed to update legacy site setting." },
      { status: 500 }
    );
  }

  return Response.json({ success: true, enabled });
}
