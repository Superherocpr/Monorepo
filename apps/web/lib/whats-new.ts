/**
 * Server-side loader for the staff "What's New" state: which changelog entries
 * a person can see and which of those they have not read yet.
 * Used by: app/(admin)/layout.tsx (sidebar unread count) and
 * app/(admin)/admin/whats-new/page.tsx (the page itself).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { CHANGELOG } from "@/content/changelog";
import { entriesForRole, entryKey, unreadEntries } from "@/lib/changelog";
import type { ChangelogEntry } from "@/types/changelog";
import type { UserRole } from "@/types/users";

/** What the admin chrome and the What's New page need to render. */
export interface WhatsNewState {
  /** Every entry the role may see, in changelog order (newest first). */
  visible: ChangelogEntry[];
  /** entryKey() of each visible entry the person has not read yet. */
  unreadKeys: string[];
}

/**
 * Loads a person's What's New state.
 * Reads profiles.whats_new_seen_version and created_at with the service-role
 * client (like the rest of the admin layout). A failed read, such as the column
 * not existing yet because migration 0079 has not been applied, yields "nothing
 * unread" rather than an error, so it can never break the auth-guarded layout.
 * @param userId - The signed-in staff member's profile id.
 * @param role - Their EFFECTIVE role (view-as aware), which decides which entries show.
 * @returns The visible entries and the keys of the unread ones.
 */
export async function loadWhatsNewState(userId: string, role: UserRole): Promise<WhatsNewState> {
  const visible = entriesForRole(CHANGELOG, role);

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("whats_new_seen_version, created_at")
    .eq("id", userId)
    .single();

  if (error || !data) {
    console.warn("[whats-new] Could not read seen version; showing nothing as unread.", error);
    return { visible, unreadKeys: [] };
  }

  const unread = unreadEntries(visible, data.whats_new_seen_version, data.created_at);
  return { visible, unreadKeys: unread.map(entryKey) };
}
