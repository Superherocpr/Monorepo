/**
 * POST /api/customers/[id]/archive
 * Called by: CustomerDetailClient — "Archive Account" confirmation
 * Auth: super_admin only — managers cannot archive accounts
 * Sets archived = true and archived_at = now() on the profile.
 * All data is preserved — this is a soft delete only.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Archives the specified customer account. Super admin only.
 * @param request - POST request (no body required).
 * @param params - Route params containing the customer ID.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  void request;
  const { id: customerId } = await params;
  const supabase = await createClient();

  // ── Auth & role check — super_admin only ───────────────────────────────────
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

  if (!actor || actor.role !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Archive the account ────────────────────────────────────────────────────
  const { error } = await supabase
    .from("profiles")
    .update({
      archived: true,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId)
    .eq("role", "customer"); // Safety: only archive customer profiles

  if (error) {
    return Response.json({ success: false, error: "Archive failed." }, { status: 500 });
  }

  return Response.json({ success: true });
}
