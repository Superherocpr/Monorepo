/**
 * PATCH /api/certifications/reminders-pause
 * Called by: CertificationsClient — pause/resume reminders toggle in page header
 * Auth: super_admin only
 * Updates the system_settings key `cert_reminders_paused` to "true" or "false".
 * Uses the admin (service role) client to write system_settings, which may have
 * restricted RLS for non-admin roles.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";

/**
 * Toggles the cert reminders paused flag in system_settings.
 * Body: { paused: boolean }
 * @param request - Incoming PATCH request with JSON body
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "super_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { paused?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.paused !== "boolean") {
    return Response.json({ error: "paused must be a boolean." }, { status: 400 });
  }

  // ── Write system_settings ──────────────────────────────────────────────────
  // Use admin client to bypass any RLS restrictions on system_settings.
  const adminSupabase = await createAdminClient();
  const { error } = await adminSupabase
    .from("system_settings")
    .upsert(
      { key: "cert_reminders_paused", value: String(body.paused) },
      { onConflict: "key" }
    );

  if (error) {
    console.error("[PATCH /api/certifications/reminders-pause] Upsert error", error);
    return Response.json({ error: "Failed to update reminder setting." }, { status: 500 });
  }

  return Response.json({ paused: body.paused });
}
