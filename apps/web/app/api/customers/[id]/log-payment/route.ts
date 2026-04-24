/**
 * POST /api/customers/[id]/log-payment
 * Called by: CustomerDetailClient — "Log Payment" slide-in panel
 * Auth: Manager and super_admin only
 * Creates a manual payment record (cash, check, or deposit).
 * Optionally links the payment to a specific booking.
 */

import { createClient } from "@/lib/supabase/server";

/** Valid manual payment types that staff can log. Online payments are handled by PayPal. */
const MANUAL_PAYMENT_TYPES = new Set(["cash", "check", "deposit"]);

/**
 * Logs a manual payment for the specified customer.
 * @param request - POST request with JSON body:
 *   { paymentType: string; amount: number; bookingId?: string; notes?: string }
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
  let body: { paymentType?: unknown; amount?: unknown; bookingId?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { paymentType, amount, bookingId, notes } = body;

  if (typeof paymentType !== "string" || !MANUAL_PAYMENT_TYPES.has(paymentType)) {
    return Response.json(
      { success: false, error: "Payment type must be cash, check, or deposit." },
      { status: 400 }
    );
  }

  const parsedAmount =
    typeof amount === "number" ? amount : parseFloat(String(amount));

  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return Response.json(
      { success: false, error: "A valid positive amount is required." },
      { status: 400 }
    );
  }

  // ── Insert payment record ──────────────────────────────────────────────────
  const { error } = await supabase.from("payments").insert({
    customer_id: customerId,
    booking_id:
      typeof bookingId === "string" && bookingId.trim().length > 0
        ? bookingId.trim()
        : null,
    logged_by: user.id,
    amount: parsedAmount,
    status: "completed",
    payment_type: paymentType,
    notes:
      typeof notes === "string" && notes.trim().length > 0
        ? notes.trim()
        : null,
  });

  if (error) {
    return Response.json({ success: false, error: "Failed to log payment." }, { status: 500 });
  }

  return Response.json({ success: true });
}
