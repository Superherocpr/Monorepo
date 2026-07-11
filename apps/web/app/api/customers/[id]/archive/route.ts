/**
 * POST /api/customers/[id]/archive
 * Called by: CustomerDetailClient — "Archive Account" confirmation
 * Auth: super_admin only — managers cannot archive accounts
 * Sets archived = true and archived_at = now() on the profile.
 * All data is preserved — this is a soft delete only.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

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

  // ── Auth & role check — super_admin only ───────────────────────────────────
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

  // ── Archive the account ────────────────────────────────────────────────────
  const { error } = await adminClient
    .from("profiles")
    .update({
      archived: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId)
    .eq("role", "customer"); // Safety: only archive customer profiles

  if (error) {
    return Response.json({ success: false, error: "Archive failed." }, { status: 500 });
  }

  return Response.json({ success: true });
}
