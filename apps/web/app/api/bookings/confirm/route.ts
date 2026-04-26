/**
 * POST /api/bookings/confirm
 * Called by: book/payment page (onApprove callback after PayPal approval)
 * Auth: None required — PayPal order ID is the verification
 *
 * Captures the PayPal payment server-side, re-verifies spot availability
 * (counting both bookings and active invoice students), creates the booking
 * and payment records, then sends a confirmation email via Resend.
 *
 * Returns 409 if the class filled up during checkout (capture already happened —
 * see TODO below for refund handling).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { getPayPalAccessToken } from "@/lib/paypal";
import { resolvePaymentRouting } from "@/lib/resolve-payment-routing";
import { Resend } from "resend";
import { bookingConfirmationEmail } from "@/lib/emails";

const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

/** Shape returned by Supabase for the availability re-check query. */
interface BookingRecord {
  id: string;
  cancelled: boolean;
}

/** Shape returned by Supabase for invoice spot-reservation accounting. */
interface InvoiceRecord {
  id: string;
  student_count: number;
  status: string;
}

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const {
    paypalOrderId,
    sessionId,
    customerId,
    amount,
    customerEmail,
    customerFirstName,
    className,
    startsAt,
    locationName,
    locationAddress,
    locationCity,
    locationState,
    locationZip,
  } = body;

  if (
    typeof paypalOrderId !== "string" ||
    typeof sessionId !== "string" ||
    typeof customerId !== "string" ||
    typeof amount !== "number"
  ) {
    return Response.json({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  // Step 1: Capture the PayPal payment server-side
  const accessToken = await getPayPalAccessToken();
  const captureResponse = await fetch(
    `${PAYPAL_API_BASE}/v2/checkout/orders/${paypalOrderId}/capture`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!captureResponse.ok) {
    const errorText = await captureResponse.text().catch(() => "Unknown capture error");
    console.error("PayPal capture failed:", errorText);
    return Response.json({ success: false, error: "Payment capture failed" }, { status: 502 });
  }

  const captureData = (await captureResponse.json()) as {
    purchase_units?: Array<{
      payments?: { captures?: Array<{ id?: string }> };
    }>;
  };

  const paypalTransactionId =
    captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null;

  // Step 2: Re-verify spot availability.
  // Invoice students count against capacity even before payment —
  // an unpaid invoice still reserves spots to prevent overbooking.
  const supabase = await createAdminClient();

  const { data: session } = await supabase
    .from("class_sessions")
    .select(`
      max_capacity,
      bookings ( id, cancelled ),
      invoices ( id, student_count, status )
    `)
    .eq("id", sessionId)
    .single();

  if (!session) {
    return Response.json({ success: false, error: "Session not found" }, { status: 404 });
  }

  const activeBookings = (session.bookings as BookingRecord[]).filter((b) => !b.cancelled).length;
  const invoiceStudents = (session.invoices as InvoiceRecord[])
    .filter((inv) => inv.status !== "cancelled")
    .reduce((sum, inv) => sum + inv.student_count, 0);
  const totalSpotsTaken = activeBookings + invoiceStudents;

  if (totalSpotsTaken >= session.max_capacity) {
    // Class is full — payment was already captured.
    // TODO: implement PayPal refund flow for this case using /v2/payments/captures/{id}/refund
    return Response.json(
      { success: false, error: "Class is now full" },
      { status: 409 }
    );
  }

  // Step 3: Create booking record
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      session_id: sessionId,
      customer_id: customerId,
      booking_source: "online",
      cancelled: false,
    })
    .select("id")
    .single();

  if (bookingError || !booking) {
    console.error("Booking insert failed:", bookingError);
    return Response.json({ success: false, error: "Failed to create booking" }, { status: 500 });
  }

  // Step 4: Create payment record (with routing audit note)
  // Routing is resolved here independently of order creation — the order was
  // already created with the correct PayPal-Auth-Assertion, but we record the
  // routing decision again on the payment row for the audit trail.
  const routing = await resolvePaymentRouting(supabase, sessionId);

  await supabase
    .from("payments")
    .insert({
      customer_id: customerId,
      booking_id: booking.id,
      amount,
      status: "completed",
      payment_type: "online",
      paypal_transaction_id: paypalTransactionId,
      routing_note: routing.routingNote,
    });

  // Step 5: Send booking confirmation + payment receipt email
  // Best-effort — booking is already confirmed even if email fails
  if (
    process.env.RESEND_API_KEY &&
    typeof customerEmail === "string" &&
    typeof startsAt === "string"
  ) {
    const resend = new Resend(process.env.RESEND_API_KEY);

    // Derive a human-readable "Payment processed by" label from the routing note.
    // "Routed to instructor PayPal — Danny Hedgeman" → "Danny Hedgeman via PayPal"
    // Anything else (business or fallback) → "SuperHeroCPR via PayPal"
    const paymentProcessor = routing.instructorPayPalAccountId
      ? `${routing.routingNote.replace("Routed to instructor PayPal — ", "")} via PayPal`
      : "SuperHeroCPR via PayPal";

    const { subject, html } = bookingConfirmationEmail({
      firstName: typeof customerFirstName === "string" ? customerFirstName : null,
      className: typeof className === "string" ? className : "CPR Class",
      startsAt,
      locationName: typeof locationName === "string" ? locationName : "",
      locationAddress: typeof locationAddress === "string" ? locationAddress : "",
      locationCity: typeof locationCity === "string" ? locationCity : "",
      locationState: typeof locationState === "string" ? locationState : "",
      locationZip: typeof locationZip === "string" ? locationZip : "",
      amount: amount as number,
      paymentProcessor,
      transactionId: paypalTransactionId,
      // Instructor name is not available in this route without an extra DB query;
      // the field is optional and the email is complete without it.
      instructorName: null,
    });

    await resend.emails
      .send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: customerEmail,
        subject,
        html,
      })
      .catch((err: unknown) => {
        console.error("Confirmation email failed (non-fatal):", err);
      });
  }

  return Response.json({ success: true, bookingId: booking.id });
}
