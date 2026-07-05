/**
 * PATCH /api/contact/[id]
 * Called by: ContactSubmissionsClient — inline "Mark as replied" button
 * Auth: manager and super_admin only
 * Marks the given contact submission as replied without sending an email.
 * Useful when the conversation was handled by phone or another channel.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

/**
 * Marks a contact submission as replied.
 * @param _request - Unused; no body required.
 * @param params - Route params containing the submission id.
 */
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!id) {
    return Response.json({ success: false, error: "Missing submission id." }, { status: 400 });
  }

  const admin = await createAdminClient();

  const { error } = await admin
    .from("contact_submissions")
    .update({ replied: true })
    .eq("id", id);

  if (error) {
    console.error("[contact/[id]] Failed to mark as replied:", error);
    return Response.json({ success: false, error: "Database update failed." }, { status: 500 });
  }

  return Response.json({ success: true });
}
