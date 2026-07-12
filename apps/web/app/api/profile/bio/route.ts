/**
 * PATCH /api/profile/bio
 * Called by: BioSettingsSection when an instructor saves their own about-page bio.
 * Auth: instructor, manager, or super_admin only. Updates the calling user's own profile.
 * Accepts bio_photo, bio_description, bio_credentials.
 * bio_published is intentionally excluded — only admins control publishing via /api/staff/[id]/bio.
 */

import { createClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import type { UserRole } from "@/types/users";

/** Roles permitted to update their own bio. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "manager", "super_admin"];

interface BioPayload {
  /** Public S3 URL for the instructor's headshot. Null clears the photo. */
  bio_photo?: string | null;
  /** Plain-text bio paragraph shown on the /about page. Null clears the description. */
  bio_description?: string | null;
  /** Comma-separated credentials shown as checkmark items on the /about page. Null clears credentials. */
  bio_credentials?: string | null;
}

/**
 * Updates the authenticated instructor's own about-page bio fields.
 * Omitting a field leaves the existing value unchanged.
 * Side effects: updates profiles row for the calling user.
 * @param request - PATCH request with JSON body containing any subset of bio fields.
 */
export async function PATCH(request: Request): Promise<Response> {
  const authResult = await requireApiRole(ALLOWED_ROLES);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  let body: BioPayload;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, string | null> = {};
  if ("bio_photo" in body) update.bio_photo = body.bio_photo ?? null;
  if ("bio_description" in body) update.bio_description = body.bio_description ?? null;
  if ("bio_credentials" in body) update.bio_credentials = body.bio_credentials ?? null;

  if (Object.keys(update).length === 0) {
    return Response.json({ success: false, error: "No fields provided to update." }, { status: 400 });
  }

  // Use the session client — the user updates their own row, which RLS permits.
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", actor.user.id);

  if (error) {
    console.error("[profile/bio] DB update failed:", error);
    return Response.json({ success: false, error: "Failed to save bio. Please try again." }, { status: 500 });
  }

  return Response.json({ success: true });
}
