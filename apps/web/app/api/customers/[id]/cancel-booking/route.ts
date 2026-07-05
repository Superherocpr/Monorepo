/**
 * POST /api/customers/[id]/cancel-booking
 * Called by: CustomerDetailClient — cancel booking confirmation
 * Auth: Manager and super_admin only
 * Cancels a booking with a required reason. Records who cancelled it.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

/**
 * Cancels a booking for the specified customer.
 * @param request - POST request with JSON body: { bookingId: string; reason: string }
 * @param params - Route params containing the customer ID.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: customerId } = await params;

  // ── Auth & role check ──────────────────────────────────────────────────────
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;
  const user = actor.user;

  const adminClient = await createAdminClient();

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { bookingId?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { bookingId, reason } = body;

  if (typeof bookingId !== "string" || !bookingId) {
    return Response.json({ success: false, error: "Booking ID is required." }, { status: 400 });
  }

  if (typeof reason !== "string" || reason.trim().length === 0) {
    return Response.json(
      { success: false, error: "A cancellation reason is required." },
      { status: 400 }
    );
  }

  // ── Cancel the booking — must belong to this customer ─────────────────────
  const { error } = await adminClient
    .from("bookings")
    .update({
      cancelled: true,
      cancellation_note: reason.trim(),
      cancelled_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("customer_id", customerId) // Ownership check
    .eq("cancelled", false); // Don't double-cancel

  if (error) {
    return Response.json({ success: false, error: "Cancellation failed." }, { status: 500 });
  }

  return Response.json({ success: true });
}
