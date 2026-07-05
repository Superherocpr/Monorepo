/**
 * PATCH /api/customers/[id]/update-tracking
 * Called by: CustomerDetailClient — "Update Tracking" inline input on orders tab
 * Auth: Manager and super_admin only
 * Updates the tracking number on a merch order belonging to this customer.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

/**
 * Updates the tracking number for a specific order.
 * @param request - PATCH request with JSON body: { orderId: string; trackingNumber: string }
 * @param params - Route params containing the customer ID.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: customerId } = await params;

  // ── Auth & role check ──────────────────────────────────────────────────────
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { orderId?: unknown; trackingNumber?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { orderId, trackingNumber } = body;

  if (typeof orderId !== "string" || !orderId) {
    return Response.json({ success: false, error: "Order ID is required." }, { status: 400 });
  }

  const cleanTracking =
    typeof trackingNumber === "string" && trackingNumber.trim().length > 0
      ? trackingNumber.trim()
      : null;

  // ── Update tracking — must belong to this customer ─────────────────────────
  const { error } = await adminClient
    .from("orders")
    .update({
      tracking_number: cleanTracking,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("customer_id", customerId); // Ownership check

  if (error) {
    return Response.json({ success: false, error: "Update failed." }, { status: 500 });
  }

  return Response.json({ success: true });
}
