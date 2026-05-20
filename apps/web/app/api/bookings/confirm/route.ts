/**
 * POST /api/bookings/confirm
 * Called by: book/payment page (onApprove callback after PayPal approval)
 * Auth: None required — PayPal order ID is the verification
 *
 * 1. Validates required fields.
 * 2. Re-fetches the class session price from the DB and verifies the client-
 *    supplied amount matches (THREAT-013).
 * 3. Captures the PayPal payment server-side.
 * 4. Atomically reserves a spot via book_spot RPC (THREAT-006). If the class
 *    filled up during checkout, the PayPal capture is refunded automatically.
 * 5. Creates the payment record (with routing audit note).
 * 6. Sends booking confirmation email via Resend (best-effort).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { getPayPalAccessToken, getPayPalApiBase } from "@/lib/paypal";
import { Resend } from "resend";
import { bookingConfirmationEmail } from "@/lib/emails";

/** Acceptable rounding tolerance when comparing client/server prices. */
const PRICE_TOLERANCE = 0.01;

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Issues a PayPal refund for a captured payment.
 * Best-effort — caller logs failures for manual reconciliation.
 * @param captureId - The PayPal capture id returned from /capture.
 */
async function refundCapture(captureId: string): Promise<void> {
  const accessToken = await getPayPalAccessToken();
  const res = await fetch(
    `${getPayPalApiBase()}/v2/payments/captures/${captureId}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Refund failed: ${res.status} ${txt}`);
  }
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

  const supabase = await createAdminClient();

  // ── Step 1: Server-side price verification (THREAT-013) ──────────────────
  // Never trust the client's amount — fetch the canonical price via the
  // class_types join and reject if it doesn't match.
  // `.maybeSingle()` (vs `.single()`) so a missing row returns null instead of
  // throwing — a missing session is a 404, not a 500.
  const { data: sessionPriceRow, error: sessionFetchError } = await supabase
    .from("class_sessions")
    .select("class_types(price)")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionFetchError) {
    console.error("[bookings/confirm] Session fetch failed:", sessionFetchError);
    return Response.json({ success: false, error: "Failed to load session" }, { status: 500 });
  }

  if (!sessionPriceRow) {
    return Response.json({ success: false, error: "Session not found" }, { status: 404 });
  }

  const classTypeJoin = (
    sessionPriceRow as { class_types: { price: number | string } | { price: number | string }[] | null }
  ).class_types;
  const classType = Array.isArray(classTypeJoin) ? classTypeJoin[0] : classTypeJoin;
  const dbPrice =
    classType?.price == null
      ? null
      : typeof classType.price === "number"
        ? classType.price
        : parseFloat(String(classType.price));

  if (dbPrice == null || !Number.isFinite(dbPrice)) {
    return Response.json({ success: false, error: "Session pricing unavailable" }, { status: 500 });
  }

  if (Math.abs(amount - dbPrice) > PRICE_TOLERANCE) {
    return Response.json(
      { success: false, error: "Pricing has changed. Please refresh and try again." },
      { status: 409 }
    );
  }

  // ── Step 2: Capture the PayPal payment server-side ───────────────────────
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
    console.error("[bookings/confirm] PayPal capture failed:", errorText);
    return Response.json({ success: false, error: "Payment capture failed" }, { status: 502 });
  }

  const captureData = (await captureResponse.json()) as {
    purchase_units?: Array<{
      payments?: { captures?: Array<{ id?: string; amount?: { value: string } }> };
    }>;
  };

  const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0];
  const paypalTransactionId = capture?.id ?? null;

  // Verify PayPal captured the expected amount (defence in depth).
  if (capture?.amount?.value) {
    const capturedAmount = parseFloat(capture.amount.value);
    if (
      Number.isFinite(capturedAmount) &&
      Math.abs(capturedAmount - dbPrice) > PRICE_TOLERANCE
    ) {
      if (paypalTransactionId) {
        await refundCapture(paypalTransactionId).catch((err) =>
          console.error("[bookings/confirm] Refund after amount mismatch failed:", err)
        );
      }
      return Response.json(
        { success: false, error: "Payment amount mismatch — transaction reversed." },
        { status: 502 }
      );
    }
  }

  // ── Step 3: Atomically reserve a spot via book_spot RPC (THREAT-006) ─────
  // The RPC locks the session row, counts bookings + invoice students, and
  // inserts the booking only if capacity remains. Errors are mapped to user-
  // facing responses below.
  const { data: bookingId, error: rpcError } = await supabase.rpc("book_spot", {
    p_session_id: sessionId,
    p_customer_id: customerId,
    p_booking_source: "online",
    p_invoice_id: null,
  });

  if (rpcError || !bookingId) {
    const msg = rpcError?.message ?? "";
    // Refund the captured payment — the customer never got the spot.
    if (paypalTransactionId) {
      await refundCapture(paypalTransactionId).catch((err) =>
        console.error("[bookings/confirm] Refund after booking failure failed:", err)
      );
    }
    if (msg.includes("session_full")) {
      return Response.json(
        { success: false, error: "Class filled up during checkout. Payment refunded." },
        { status: 409 }
      );
    }
    if (msg.includes("session_unavailable")) {
      return Response.json(
        { success: false, error: "Class is no longer available. Payment refunded." },
        { status: 410 }
      );
    }
    if (msg.includes("session_not_found")) {
      return Response.json(
        { success: false, error: "Session not found. Payment refunded." },
        { status: 404 }
      );
    }
    console.error("[bookings/confirm] book_spot failed:", rpcError);
    return Response.json(
      { success: false, error: "Failed to create booking. Payment refunded." },
      { status: 500 }
    );
  }

  // ── Step 4: Create payment record (with routing audit note) ──────────────
  // Derive routing from the capture's payee.merchant_id — the source of truth
  // for where the funds actually landed. If it matches an instructor's stored
  // payer_id, attribute the payment to them; otherwise it went to the business.
  let routingNote = "Routed to SuperHeroCPR business PayPal";
  let paymentProcessor = "SuperHeroCPR via PayPal";
  if (payeeMerchantId) {
    const { data: instructorAcct } = await supabase
      .from("instructor_payment_accounts")
      .select("instructor_id, profiles!instructor_payment_accounts_instructor_id_fkey(full_name)")
      .eq("platform", "paypal")
      .eq("platform_account_id", payeeMerchantId)
      .maybeSingle();
    if (instructorAcct) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profile = (instructorAcct as any).profiles;
      const profileRow = Array.isArray(profile) ? profile[0] : profile;
      const instructorName: string =
        profileRow?.full_name ?? "instructor";
      routingNote = `Routed to instructor PayPal — ${instructorName}`;
      paymentProcessor = `${instructorName} via PayPal`;
    }
  }

  const { error: paymentInsertError } = await supabase
    .from("payments")
    .insert({
      customer_id: customerId,
      booking_id: bookingId,
      amount: dbPrice,
      status: "completed",
      payment_type: "online",
      paypal_transaction_id: paypalTransactionId,
      routing_note: routingNote,
    });

  // Insert failure leaves a booking with no payment record — log loudly so
  // ops can reconcile manually. Do NOT 500 the user: their booking exists and
  // their card was charged; failing the response would just confuse them.
  if (paymentInsertError) {
    console.error(
      "[bookings/confirm] CRITICAL: payment record insert failed",
      {
        bookingId,
        paypalTransactionId,
        amount: dbPrice,
        error: paymentInsertError,
      }
    );
  }

  // ── Step 5: Send booking confirmation email (best-effort) ────────────────
  if (
    process.env.RESEND_API_KEY &&
    typeof customerEmail === "string" &&
    typeof startsAt === "string"
  ) {
    const resend = new Resend(process.env.RESEND_API_KEY);

    const { subject, html } = bookingConfirmationEmail({
      firstName: typeof customerFirstName === "string" ? customerFirstName : null,
      className: typeof className === "string" ? className : "CPR Class",
      startsAt,
      locationName: typeof locationName === "string" ? locationName : "",
      locationAddress: typeof locationAddress === "string" ? locationAddress : "",
      locationCity: typeof locationCity === "string" ? locationCity : "",
      locationState: typeof locationState === "string" ? locationState : "",
      locationZip: typeof locationZip === "string" ? locationZip : "",
      amount: dbPrice,
      paymentProcessor,
      transactionId: paypalTransactionId,
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
        console.error("[bookings/confirm] Confirmation email failed (non-fatal):", err);
      });
  }

  return Response.json({ success: true, bookingId });
}
