/**
 * POST /api/bookings/confirm
 * Called by: book/payment page (onApprove callback after PayPal approval)
 * Auth: None required — PayPal order ID is the verification
 *
 * 1. Validates required fields.
 * 2. Re-fetches the class session price from the DB and re-validates any promo
 *    code server-side, then verifies the client-supplied amount matches (THREAT-013).
 * 3. Captures the PayPal payment server-side.
 * 4. Atomically reserves a spot via book_spot RPC (THREAT-006). If the class
 *    filled up during checkout, the PayPal capture is refunded automatically.
 * 5. Creates the payment record and instructor earning record.
 * 6. Sends booking confirmation email via Resend (best-effort).
 *
 * Note: free (100% off) bookings use /api/bookings/confirm-free instead.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { getPayPalAccessToken, getPayPalApiBase } from "@/lib/paypal";
import { Resend } from "resend";
import { bookingConfirmationEmail } from "@/lib/emails";
import { recordBookingEarning } from "@/lib/instructor-earnings";
import { maybeTriggerImmediatePayout } from "@/lib/payout-trigger";
import { resolvePromoDiscount } from "@/lib/promo-codes";

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
    promoCode,
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

  // ── Step 1: Server-side price + promo verification (THREAT-013) ──────────
  // Never trust the client's amount — fetch the canonical price via the
  // class_types join, re-validate the promo code (if any), then reject if the
  // client-supplied amount doesn't match the server-computed final price.
  const { data: sessionPriceRow, error: sessionFetchError } = await supabase
    .from("class_sessions")
    .select("instructor_id, class_types(price)")
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
    sessionPriceRow as {
      instructor_id: string;
      class_types: { price: number | string } | { price: number | string }[] | null;
    }
  ).class_types;
  const instructorId = (sessionPriceRow as { instructor_id: string }).instructor_id;
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

  // Re-validate the promo code server-side and compute the authoritative final price.
  let expectedPrice = dbPrice;
  let appliedPromoCode: string | null = null;
  let discountAmount = 0;

  if (typeof promoCode === "string" && promoCode.trim()) {
    const promoResult = await resolvePromoDiscount(supabase, promoCode.trim(), sessionId, dbPrice);
    if (!promoResult.valid) {
      return Response.json(
        { success: false, error: `Promo code invalid: ${promoResult.error}` },
        { status: 422 }
      );
    }
    expectedPrice = promoResult.finalPrice;
    appliedPromoCode = promoResult.code;
    discountAmount = promoResult.discountAmount;
  }

  if (Math.abs(amount - expectedPrice) > PRICE_TOLERANCE) {
    return Response.json(
      { success: false, error: "Pricing has changed. Please refresh and try again." },
      { status: 409 }
    );
  }

  // ── Step 2: Capture the PayPal payment server-side ───────────────────────
  const accessToken = await getPayPalAccessToken();
  const captureResponse = await fetch(
    `${getPayPalApiBase()}/v2/checkout/orders/${paypalOrderId}/capture`,
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

  const purchaseUnit = captureData.purchase_units?.[0];
  const capture = purchaseUnit?.payments?.captures?.[0];
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

  // ── Step 4: Create payment + instructor earning records ─────────────────
  // All online booking funds now land in the SuperHeroCPR business PayPal
  // account. The instructor receives their share through the payout system.
  const routingNote = appliedPromoCode
    ? `Collected by SuperHeroCPR business PayPal (promo: ${appliedPromoCode}, discount: $${discountAmount.toFixed(2)}) — instructor payout pending`
    : "Collected by SuperHeroCPR business PayPal — instructor payout pending";
  const paymentProcessor = "SuperHeroCPR via PayPal";

  const { data: paymentRow, error: paymentInsertError } = await supabase
    .from("payments")
    .insert({
      customer_id: customerId,
      booking_id: bookingId,
      // Record the actual amount charged (after discount), not the base price.
      amount: expectedPrice,
      status: "completed",
      payment_type: "online",
      paypal_transaction_id: paypalTransactionId,
      routing_note: routingNote,
    })
    .select("id")
    .single();

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

  await recordBookingEarning(supabase, {
    instructorId,
    bookingId: bookingId as string,
    paymentId: (paymentRow as { id?: string } | null)?.id ?? null,
    grossAmount: expectedPrice,
    note: routingNote,
  }).catch((err: unknown) => {
    console.error("[bookings/confirm] CRITICAL: instructor earning insert failed", {
      bookingId,
      paypalTransactionId,
      amount: expectedPrice,
      error: err,
    });
  });

  // Fire a payout immediately if the system is configured for immediate trigger mode.
  // Non-blocking: the customer response is not delayed by the payout call.
  await maybeTriggerImmediatePayout(supabase);

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
      amount: expectedPrice,
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
