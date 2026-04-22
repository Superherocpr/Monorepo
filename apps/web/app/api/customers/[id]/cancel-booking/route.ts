/**
 * POST /api/customers/[id]/cancel-booking
 * Called by: CustomerDetailClient — cancel booking confirmation
 * Auth: Manager and super_admin only
 * Cancels a booking with a required reason. Records who cancelled it.
 */

import { createClient } from "@/lib/supabase/server";

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
  const { error } = await supabase
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
