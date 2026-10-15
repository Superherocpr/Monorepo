/**
 * POST /api/profile/whats-new-seen
 * Called by: the What's New page (WhatsNewList) right after it renders unread entries
 * Auth: any staff role; own profile only
 * Marks the changelog as read for the signed-in person by setting
 * profiles.whats_new_seen_version to the newest version in the changelog. The
 * version comes from the server's own changelog, never from the request, so a
 * caller cannot claim to have seen a version that does not exist.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApiRole, STAFF_ROLES } from "@/lib/auth/effective-role";
import { CHANGELOG } from "@/content/changelog";
import { latestVersion } from "@/lib/changelog";

/**
 * Records that the current staff member has read everything in the changelog.
 * Side effects: updates profiles.whats_new_seen_version for the authenticated user.
 * @returns `{ data: { version }, error: null }` on success.
 */
export async function POST() {
  const authResult = await requireApiRole(STAFF_ROLES);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const version = latestVersion(CHANGELOG);
  if (!version) return NextResponse.json({ data: { version: null }, error: null });

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ whats_new_seen_version: version })
    .eq("id", actor.user.id);

  if (error) {
    console.error("[profile/whats-new-seen] Update failed:", error);
    return NextResponse.json({ data: null, error: "Failed to save." }, { status: 500 });
  }

  return NextResponse.json({ data: { version }, error: null });
}
