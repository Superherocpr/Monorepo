/**
 * Public display name of the lead instructor.
 *
 * Used by: the home page "Meet Your Instructor" section and the blog post byline.
 *
 * Reads through the admin client on purpose. The `profiles` table has no public
 * (anon) read policy: it holds every customer's and staff member's contact
 * details, and an open policy let anyone with the site's public API key list
 * all of it. The name is the only thing these pages need, so this selects
 * exactly those two columns and nothing else.
 */

import { createAdminClient } from "@/lib/supabase/server";

/**
 * Fetches the active lead instructor's "First Last" name.
 * Side effects: one read-only database query.
 * @returns The display name, or null when no active lead instructor is found
 *   (or the lookup fails), so the caller can render its own fallback wording.
 */
export async function getLeadInstructorName(): Promise<string | null> {
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("is_lead_instructor", true)
    .eq("deactivated", false)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[lead-instructor] Lookup failed:", error.message);
    return null;
  }
  return `${data.first_name} ${data.last_name}`;
}
