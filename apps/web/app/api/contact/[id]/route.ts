/**
 * PATCH /api/contact/[id]
 * Called by: ContactSubmissionsClient — mark replied, toggle called, save notes
 * Auth: manager and super_admin only
 * Body: { action: "replied" } | { action: "called"; called: boolean } | { action: "notes"; notes: string }
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

type PatchBody =
  | { action: "replied" }
  | { action: "called"; called: boolean }
  | { action: "notes"; notes: string };

/**
 * Updates a contact submission field.
 * - "replied": marks the submission as replied
 * - "called":  sets the called flag to the given boolean
 * - "notes":   saves free-form staff notes
 * @param request - JSON body with action discriminant.
 * @param params  - Route params containing the submission id.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;

  const { id } = await params;
  if (!id) {
    return Response.json({ success: false, error: "Missing submission id." }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  let update: Record<string, unknown>;

  if (body.action === "replied") {
    update = { replied: true };
  } else if (body.action === "called") {
    if (typeof (body as { called?: unknown }).called !== "boolean") {
      return Response.json({ success: false, error: "Invalid called value." }, { status: 400 });
    }
    update = { called: body.called };
  } else if (body.action === "notes") {
    if (typeof (body as { notes?: unknown }).notes !== "string") {
      return Response.json({ success: false, error: "Invalid notes value." }, { status: 400 });
    }
    update = { notes: body.notes };
  } else {
    return Response.json({ success: false, error: "Unknown action." }, { status: 400 });
  }

  const admin = await createAdminClient();

  const { error } = await admin
    .from("contact_submissions")
    .update(update)
    .eq("id", id);

  if (error) {
    console.error("[contact/[id]] PATCH failed:", error);
    return Response.json({ success: false, error: "Database update failed." }, { status: 500 });
  }

  return Response.json({ success: true });
}
