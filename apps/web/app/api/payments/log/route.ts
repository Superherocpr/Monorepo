/**
 * POST /api/payments/log
 * Called by: PaymentsClient — Log Payment slide-in panel
 * Auth: manager and super_admin only
 * Creates a manual payment record (cash, check, or deposit) linked to a
 * specific customer and booking. Sets status = 'completed' and logged_by = actor.
 */

import { createClient } from "@/lib/supabase/server";

/** Allowed manual payment types — excludes online and invoice (system-generated). */
const MANUAL_PAYMENT_TYPES = new Set(["cash", "check", "deposit"]);

/**
 * Logs a manual payment for the given customer and booking.
 * @param request - POST request with JSON body: { customerId, bookingId, paymentType, amount, notes? }
 */
export async function POST(request: Request) {
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
  let body: {
    customerId?: unknown;
    bookingId?: unknown;
    paymentType?: unknown;
    amount?: unknown;
    notes?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { customerId, bookingId, paymentType, amount, notes } = body;

  if (typeof customerId !== "string" || !customerId) {
    return Response.json({ success: false, error: "customerId is required." }, { status: 400 });
  }
  if (typeof bookingId !== "string" || !bookingId) {
    return Response.json({ success: false, error: "bookingId is required." }, { status: 400 });
  }
  if (typeof paymentType !== "string" || !MANUAL_PAYMENT_TYPES.has(paymentType)) {
    return Response.json({ success: false, error: "Invalid payment type." }, { status: 400 });
  }

  const parsedAmount = typeof amount === "number" ? amount : parseFloat(String(amount));
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return Response.json({ success: false, error: "Invalid amount." }, { status: 400 });
  }

  const cleanNotes =
    typeof notes === "string" && notes.trim().length > 0
      ? notes.trim()
      : null;

  // ── Verify the booking belongs to this customer ────────────────────────────
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, customer_id, cancelled")
    .eq("id", bookingId)
    .eq("customer_id", customerId)
    .single();

  if (!booking) {
    return Response.json(
      { success: false, error: "Booking not found for this customer." },
      { status: 404 }
    );
  }

  if (booking.cancelled) {
    return Response.json(
      { success: false, error: "Cannot log a payment for a cancelled booking." },
      { status: 422 }
    );
  }

  // ── Insert payment ─────────────────────────────────────────────────────────
  const { error } = await supabase.from("payments").insert({
    customer_id: customerId,
    booking_id: bookingId,
    payment_type: paymentType,
    amount: parsedAmount,
    status: "completed",
    logged_by: user.id,
    notes: cleanNotes,
  });

  if (error) {
    console.error("[payments/log] insert error:", error);
    return Response.json({ success: false, error: "Failed to log payment." }, { status: 500 });
  }

  return Response.json({ success: true });
}
