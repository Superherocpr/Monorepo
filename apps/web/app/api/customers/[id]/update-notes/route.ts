/**
 * PATCH /api/customers/[id]/update-notes
 * Called by: CustomerDetailClient — Notes tab textarea auto-save on blur
 * Auth: Manager and super_admin only
 * Updates the internal staff notes for a customer. These notes are never
 * shown to the customer — they are admin-only.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Saves staff notes for the specified customer.
 * @param request - PATCH request with JSON body: { notes: string | null }
 * @param params - Route params containing the customer ID.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: customerId } = await params;
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
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

  if (!actor || (actor.role !== "manager" && actor.role !== "super_admin")) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const cleanNotes =
    typeof body.notes === "string" && body.notes.trim().length > 0
      ? body.notes.trim()
      : null;

  // ── Update notes ───────────────────────────────────────────────────────────
  const { error } = await supabase
    .from("profiles")
    .update({
      customer_notes: cleanNotes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId)
    .eq("role", "customer"); // Safety: only update customer profiles

  if (error) {
    return Response.json({ success: false, error: "Save failed." }, { status: 500 });
  }

  return Response.json({ success: true });
}
