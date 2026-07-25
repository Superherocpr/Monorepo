/**
 * POST /api/settings/nav-visibility
 * Called by: Admin Settings — Navigation visibility toggles (SettingsClient.tsx)
 * Auth: super_admin only
 *
 * Writes a boolean visibility flag to system_settings for a public nav page.
 * When disabled (false), the page is hidden from the nav header and redirected
 * to / at the middleware level, making it inaccessible to site visitors.
 */

import { createClient } from "@/lib/supabase/server";
import { updateSetting } from "@/lib/zoho";
import type { UserRole } from "@/types/users";

const VALID_PAGES = ["classes", "schedule", "merch", "blog", "about", "contact"] as const;
type NavPage = (typeof VALID_PAGES)[number];

/** Maps each nav page identifier to its system_settings key. */
const SETTING_KEY: Record<NavPage, string> = {
  classes:  "nav_classes_enabled",
  schedule: "nav_schedule_enabled",
  merch:    "nav_merch_enabled",
  blog:     "nav_blog_enabled",
  about:    "nav_about_enabled",
  contact:  "nav_contact_enabled",
};

/**
 * Toggles the visibility of a public nav page.
 * Expects JSON body: { page: NavPage, enabled: boolean }
 * Returns: { success: true, page, enabled } on success.
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();

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

  const body = await request.json().catch(() => null);
  const page = (body as { page?: unknown })?.page;
  const enabled = (body as { enabled?: unknown })?.enabled;

  if (typeof page !== "string" || !VALID_PAGES.includes(page as NavPage)) {
    return Response.json(
      { success: false, error: "Invalid page. Must be one of: " + VALID_PAGES.join(", ") },
      { status: 400 }
    );
  }
  if (typeof enabled !== "boolean") {
    return Response.json(
      { success: false, error: "Missing or invalid `enabled` boolean." },
      { status: 400 }
    );
  }

  try {
    await updateSetting(SETTING_KEY[page as NavPage], enabled ? "true" : "false");
  } catch (err) {
    console.error("[/api/settings/nav-visibility] updateSetting failed:", err);
    return Response.json(
      { success: false, error: "Failed to update nav visibility setting." },
      { status: 500 }
    );
  }

  return Response.json({ success: true, page, enabled });
}
