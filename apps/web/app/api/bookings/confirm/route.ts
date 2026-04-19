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
import { Resend } from "resend";

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

  // Step 4: Create payment record
  await supabase
    .from("payments")
    .insert({
      customer_id: customerId,
      booking_id: booking.id,
      amount,
      status: "completed",
      payment_type: "online",
      paypal_transaction_id: paypalTransactionId,
    });

  // Step 5: Send booking confirmation + payment receipt email
  // Best-effort — booking is already confirmed even if email fails
  if (
    process.env.RESEND_API_KEY &&
    typeof customerEmail === "string" &&
    typeof startsAt === "string"
  ) {
    // Instantiated inside the conditional so it never executes at build time
    const resend = new Resend(process.env.RESEND_API_KEY);
    const formattedDate = new Date(startsAt).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const formattedTime = new Date(startsAt).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    await resend.emails
      .send({
        from: "Superhero CPR <noreply@superherocpr.com>",
        to: customerEmail,
        subject: `Booking Confirmed — ${className} on ${formattedDate}`,
        html: `
          <h1>You're booked!</h1>
          <p>Hi ${customerFirstName ?? "there"},</p>
          <p>Your booking for <strong>${className}</strong> has been confirmed. Here are your details:</p>
          <table cellpadding="6">
            <tr><td><strong>Class:</strong></td><td>${className}</td></tr>
            <tr><td><strong>Date:</strong></td><td>${formattedDate}</td></tr>
            <tr><td><strong>Time:</strong></td><td>${formattedTime}</td></tr>
            <tr><td><strong>Location:</strong></td><td>${locationName}<br>${locationAddress}<br>${locationCity}, ${locationState} ${locationZip}</td></tr>
            <tr><td><strong>Amount paid:</strong></td><td>$${(amount as number).toFixed(2)}</td></tr>
            <tr><td><strong>Transaction ID:</strong></td><td>${paypalTransactionId ?? "N/A"}</td></tr>
          </table>
          <p>Please arrive a few minutes early. Wear comfortable clothing.</p>
          <p>Questions? Reply to this email or call us at (813) 966-3969.</p>
          <p>See you in class!<br>— The Superhero CPR Team</p>
        `,
      })
      .catch((err: unknown) => {
        console.error("Confirmation email failed (non-fatal):", err);
      });
  }

  return Response.json({ success: true, bookingId: booking.id });
}
