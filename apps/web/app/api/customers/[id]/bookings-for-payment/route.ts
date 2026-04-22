/**
 * GET /api/customers/[id]/bookings-for-payment
 * Called by: PaymentsClient — Log Payment panel, after customer selection
 * Auth: manager and super_admin only
 * Returns a customer's non-cancelled bookings for use as options in the
 * Log Payment booking dropdown. Returns upcoming bookings first, then recent past.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Returns bookings for the given customer ID, formatted for dropdown display.
 * @param _request - GET request (no body used).
 * @param params - Route params containing the customer ID.
 */
export async function GET(
  _request: Request,
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

  // ── Fetch non-cancelled bookings for this customer ─────────────────────────
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      `
      id,
      class_sessions (
        starts_at,
        class_types ( name )
      )
    `
    )
    .eq("customer_id", customerId)
    .eq("cancelled", false)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return Response.json({ success: false, error: "Failed to fetch bookings." }, { status: 500 });
  }

  // Format for dropdown consumption
  const formatted = (bookings ?? []).map((b) => {
    // Supabase types the FK join as array; at runtime it's a single object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = b.class_sessions as unknown as any;
    return {
      id: b.id,
      session_name: session?.class_types?.name ?? "Class",
      session_date: session?.starts_at ?? "",
    };
  });

  return Response.json({ success: true, bookings: formatted });
}
