/**
 * POST /api/customers/[id]/add-booking
 * Called by: CustomerDetailClient — "Add Booking" slide-in panel
 * Auth: Manager and super_admin only
 * Creates a manual booking for the customer in an approved upcoming session.
 * Requires a reason explaining why the booking is being added manually.
 * Sends a booking confirmation email to the customer if email settings are configured.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { Resend } from "resend";
import { bookingConfirmationEmail } from "@/lib/emails";

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
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;
  const user = actor.user;

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
    .select(
      `id, max_capacity, approval_status, status, starts_at, instructor_id,
      class_types ( name ),
      locations ( name, address, city, state, zip ),
      profiles!instructor_id ( first_name, last_name, email, phone ),
      bookings!session_id ( id, cancelled )`
    )
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

  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    const { data: customerProfile } = await supabase
      .from("profiles")
      .select("first_name, email")
      .eq("id", customerId)
      .maybeSingle();

    const resolvedEmail = customerProfile?.email ?? null;
    const customerFirstName = customerProfile?.first_name ?? null;
    const instructorProfile = Array.isArray(session.profiles)
      ? session.profiles[0]
      : session.profiles;
    const className = (() => {
      const ct = session.class_types as unknown;
      if (!ct) return "CPR Class";
      if (Array.isArray(ct)) return (ct[0] as any)?.name ?? "CPR Class";
      if (typeof ct === "object" && ct !== null) return (ct as any).name ?? "CPR Class";
      return "CPR Class";
    })();
    const location = Array.isArray(session.locations)
      ? session.locations[0] ?? null
      : session.locations ?? null;

    if (!resolvedEmail) {
      console.error("[customers/[id]/add-booking] Confirmation email not sent: no customer email on file", {
        customerId,
        sessionId,
      });
    } else {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { subject, html } = bookingConfirmationEmail({
          firstName: customerFirstName,
          className,
          startsAt: session.starts_at,
          locationName: location?.name ?? "",
          locationAddress: location?.address ?? "",
          locationCity: location?.city ?? "",
          locationState: location?.state ?? "",
          locationZip: location?.zip ?? "",
          amount: 0,
          paymentProcessor: "Manual booking",
          transactionId: null,
          instructorName: instructorProfile
            ? `${instructorProfile.first_name} ${instructorProfile.last_name}`
            : null,
          instructorEmail: instructorProfile?.email ?? null,
          instructorPhone: instructorProfile?.phone ?? null,
        });

        const { error: emailError } = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL ?? "",
          to: resolvedEmail,
          subject,
          html,
        });

        if (emailError) {
          console.error("[customers/[id]/add-booking] Confirmation email failed:", emailError);
        }
      } catch (emailErr) {
        console.error("[customers/[id]/add-booking] Confirmation email failed:", emailErr);
      }
    }
  }

  return Response.json({ success: true });
}
