/**
 * POST /api/customers/[id]/add-booking
 * Called by: CustomerDetailClient — "Add Booking" slide-in panel
 * Auth: Manager and super_admin only
 * Creates a manual booking for the customer in an approved upcoming session.
 * Requires a reason explaining why the booking is being added manually.
 */

import { createAdminClient } from "@/lib/supabase/server";

/**
 * Adds a manual booking for the specified customer.
 * @param request - POST request with JSON body: { sessionId: string; reason: string }
 * @param params - Route params containing the customer ID.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: customerId } = await params;
  // Use admin client so we can insert bookings regardless of RLS policies.
  const supabase = await createAdminClient();

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
  let body: { sessionId?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { sessionId, reason } = body;

  if (typeof sessionId !== "string" || !sessionId) {
    return Response.json({ success: false, error: "Session is required." }, { status: 400 });
  }

  if (typeof reason !== "string" || reason.trim().length === 0) {
    return Response.json({ success: false, error: "A reason is required for manual bookings." }, { status: 400 });
  }

  // ── Verify session is approved and has spots ───────────────────────────────
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, max_capacity, approval_status, status, starts_at, bookings!session_id ( id, cancelled )")
    .eq("id", sessionId)
    .single();

  if (!session || session.approval_status !== "approved" || session.status !== "scheduled") {
    return Response.json(
      { success: false, error: "Session is not available for booking." },
      { status: 400 }
    );
  }

  if (new Date(session.starts_at) <= new Date()) {
    return Response.json(
      { success: false, error: "Cannot book a session that has already started." },
      { status: 400 }
    );
  }

  const confirmedCount = (session.bookings ?? []).filter(
    (b: { cancelled: boolean }) => !b.cancelled
  ).length;

  if (confirmedCount >= session.max_capacity) {
    return Response.json(
      { success: false, error: "This session is full." },
      { status: 409 }
    );
  }

  // ── Create the booking ─────────────────────────────────────────────────────
  const { error } = await supabase.from("bookings").insert({
    session_id: sessionId,
    customer_id: customerId,
    booking_source: "manual",
    created_by: user.id,
    manual_booking_reason: reason.trim(),
    cancelled: false,
  });

  if (error) {
    return Response.json({ success: false, error: "Failed to create booking." }, { status: 500 });
  }

  return Response.json({ success: true });
}
