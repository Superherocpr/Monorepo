/**
 * POST /api/bookings/confirm
 * Called by: book/payment page (onApprove callback after PayPal approval)
 * Auth: None required — PayPal order ID is the verification
 *
 * 1. Validates required fields.
 * 2. Re-fetches the class session price from the DB, re-validates any promo
 *    code and any selected add-ons (against session_addons, migration 0036)
 *    server-side, then verifies the client-supplied amount matches (THREAT-013).
 * 3. Captures the PayPal payment server-side.
 * 4. Atomically reserves a spot via book_spot RPC (THREAT-006), which also
 *    rejects a duplicate booking attempt for the same customer + session
 *    (THREAT-047). If the class filled up or the customer is already booked,
 *    the PayPal capture is refunded automatically.
 * 5. Records purchased add-ons (booking_addons, price snapshotted).
 * 6. Creates the payment record and instructor earning record.
 * 7. Sends booking confirmation email via Resend (best-effort).
 *
 * Note: free (100% off) bookings use /api/bookings/confirm-free instead — that
 * route rejects any request that includes add-ons, since add-ons always cost
 * money even when a promo code zeroes out the class price.
 */

import { createAdminClient } from "@/lib/supabase/server";
import {
  getPayPalAccessToken,
  getPayPalApiBase,
  evaluateCaptureOutcome,
  classifyCaptureRequestError,
} from "@/lib/paypal";
import { Resend } from "resend";
import { bookingConfirmationEmail, instructorBookingNotificationEmail } from "@/lib/emails";
import { recordBookingEarning } from "@/lib/instructor-earnings";
import { maybeTriggerImmediatePayout } from "@/lib/payout-trigger";
import { resolvePromoDiscount } from "@/lib/promo-codes";
import { resolveAddonsSelection, type ResolvedAddon } from "@/lib/addon-checkout";
import { maybeSendAssistantReminder } from "@/lib/assistant-reminder";
import { getSessionPricing } from "@/lib/session-pricing";

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
    addonIds,
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

  if (addonIds !== undefined && (!Array.isArray(addonIds) || !addonIds.every((id) => typeof id === "string"))) {
    return Response.json({ success: false, error: "addonIds must be an array of strings" }, { status: 400 });
  }

  const supabase = await createAdminClient();

  // ── Step 1: Server-side price + promo verification (THREAT-013) ──────────
  // Never trust the client's amount. getSessionPricing() is the single source
  // of truth for the instructor-discounted base price, shared with
  // promo-codes/validate, create-booking-order, and confirm-free — then we
  // re-validate the promo code (if any) and reject if the client-supplied
  // amount doesn't match the server-computed final price.
  const pricing = await getSessionPricing(supabase, sessionId);

  if (!pricing.found) {
    console.error("[bookings/confirm] Session pricing lookup failed:", pricing.error);
    const status = pricing.error === "Session not found" ? 404 : 500;
    return Response.json({ success: false, error: pricing.error }, { status });
  }

  const instructorId = pricing.instructorId;
  const dbPrice = pricing.basePrice;

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

  // Re-validate the add-on selection server-side and fold the total into the
  // authoritative expected price — same THREAT-013 reasoning as the promo code above.
  let resolvedAddons: ResolvedAddon[] = [];
  if (Array.isArray(addonIds) && addonIds.length > 0) {
    const addonsResult = await resolveAddonsSelection(supabase, sessionId, addonIds as string[]);
    if (!addonsResult.valid) {
      return Response.json({ success: false, error: addonsResult.error }, { status: 422 });
    }
    resolvedAddons = addonsResult.addons;
    expectedPrice = parseFloat((expectedPrice + addonsResult.total).toFixed(2));
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

    // PayPal rejects a declined card at the HTTP level too (422 PAYMENT_DENIED),
    // not only as a 2xx capture with status DECLINED (see evaluateCaptureOutcome
    // below) — confirmed live 2026-08-04. Give the buyer actionable advice
    // instead of "please refresh and try again", which is wrong for a decline.
    const { declined } = classifyCaptureRequestError(errorText);
    if (declined) {
      return Response.json(
        {
          success: false,
          declined: true,
          error: "Your card was declined and no payment was taken. Please try a different card.",
        },
        { status: 402 }
      );
    }

    return Response.json({ success: false, error: "Payment capture failed" }, { status: 502 });
  }

  const captureData = await captureResponse.json();

  // ── Step 2a: Reject any capture that did not actually settle (THREAT-054) ──
  // A declined card still returns HTTP 201 with a full seller_receivable_breakdown
  // and an amount matching the order, so `captureResponse.ok` plus an amount check
  // is NOT sufficient — the only reliable signal is capture.status === "COMPLETED".
  // Everything below this point (booking, payment row, instructor earning, payout,
  // confirmation email) must be unreachable unless money genuinely moved.
  const outcome = evaluateCaptureOutcome(captureData);

  if (!outcome.settled) {
    console.error("[bookings/confirm] Capture did not settle — no booking created", {
      paypalOrderId,
      sessionId,
      customerId,
      captureStatus: outcome.status,
      captureId: outcome.captureId,
      processorResponseCode: outcome.processorResponseCode,
    });

    // Nothing to refund — a declined/failed capture never took the funds.
    // PENDING is also rejected: the money is not settled, so confirming the
    // booking would recreate the same phantom-revenue problem.
    // TODO: subscribe to PAYMENT.CAPTURE.COMPLETED to auto-confirm a booking if
    // a PENDING capture later settles, instead of asking the buyer to retry.
    const isPending = outcome.status === "PENDING";
    return Response.json(
      {
        success: false,
        declined: !isPending,
        error: isPending
          ? "Your payment is still being reviewed by PayPal and hasn't completed. " +
            "Your spot is not yet reserved — please contact us at (813) 966-3969 before rebooking."
          : "Your card was declined and no payment was taken. " +
            "Please try a different card or payment method.",
      },
      { status: 402 }
    );
  }

  const paypalTransactionId = outcome.captureId;

  // PayPal reports its exact processing fee on the capture itself. Recording it
  // here is the only way the payout dashboard can show real margin rather than
  // the gross platform-fee percentage, which overstates profit by roughly 20%.
  // Only read from a settled capture — PayPal populates this block on declined
  // captures too, which is what previously produced phantom revenue.
  const captureFees = outcome.fees;

  // Verify PayPal captured the expected amount (defence in depth).
  // Compares against expectedPrice (class price − promo + add-ons), not the raw
  // dbPrice — a prior version compared against dbPrice, which would have wrongly
  // triggered a refund+reject for any promo-discounted booking above 1 cent.
  if (outcome.capturedAmount !== null) {
    if (Math.abs(outcome.capturedAmount - expectedPrice) > PRICE_TOLERANCE) {
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
    if (msg.includes("already_booked")) {
      return Response.json(
        { success: false, error: "You're already booked into this class. Payment refunded." },
        { status: 409 }
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

  // Best-effort: notify the instructor if this booking pushed a BLS/ACLS
  // class to the assistant-required threshold (9 paid students).
  const assistantBaseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
  await maybeSendAssistantReminder(supabase, sessionId, assistantBaseUrl).catch((err: unknown) => {
    console.error("[bookings/confirm] Assistant reminder check failed (non-fatal):", err);
  });

  // Record the purchased add-ons, snapshotting price_at_booking — never a live
  // join to addons.price, so later catalog price changes don't rewrite history.
  if (resolvedAddons.length > 0) {
    const { error: addonInsertError } = await supabase.from("booking_addons").insert(
      resolvedAddons.map((a) => ({
        booking_id: bookingId,
        addon_id: a.id,
        price_at_booking: a.price,
      }))
    );
    if (addonInsertError) {
      console.error("[bookings/confirm] CRITICAL: booking_addons insert failed", {
        bookingId,
        addonIds: resolvedAddons.map((a) => a.id),
        error: addonInsertError,
      });
    }
  }

  // ── Step 4: Create payment + instructor earning records ─────────────────
  // All online booking funds now land in the SuperHeroCPR business PayPal
  // account. The instructor receives their share through the payout system.
  const addonsNote =
    resolvedAddons.length > 0
      ? ` + add-ons: ${resolvedAddons.map((a) => `${a.name} ($${a.price.toFixed(2)})`).join(", ")}`
      : "";
  const routingNote = appliedPromoCode
    ? `Collected by SuperHeroCPR business PayPal (promo: ${appliedPromoCode}, discount: $${discountAmount.toFixed(2)}) — instructor payout pending${addonsNote}`
    : `Collected by SuperHeroCPR business PayPal — instructor payout pending${addonsNote}`;
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
      // Null when PayPal omitted the breakdown — null means "not tracked", not zero.
      paypal_fee_amount: captureFees.paypalFee,
      net_amount: captureFees.netAmount,
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
  if (process.env.RESEND_API_KEY && typeof startsAt === "string") {
    // Fetch instructor + customer contact details server-side — never trust
    // client-supplied values. The customer profile fetch is also a fallback:
    // an existing customer who signed in (rather than creating a new account)
    // never populates customerEmail/customerFirstName on the client, since
    // that step is skipped for sign-in — without this fallback the email
    // silently never sends for that entire customer segment.
    const [{ data: instructorProfile }, { data: customerProfile }] = await Promise.all([
      supabase
        .from("profiles")
        .select("first_name, last_name, email, phone")
        .eq("id", instructorId)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("id", customerId)
        .maybeSingle(),
    ]);

    const resolvedCustomerEmail =
      typeof customerEmail === "string" && customerEmail ? customerEmail : customerProfile?.email;

    if (!resolvedCustomerEmail) {
      console.error("[bookings/confirm] CRITICAL: no email on file — confirmation not sent", {
        bookingId,
        customerId,
      });
    } else {
      const resend = new Resend(process.env.RESEND_API_KEY);

      const { subject, html } = bookingConfirmationEmail({
        firstName:
          typeof customerFirstName === "string" && customerFirstName
            ? customerFirstName
            : (customerProfile?.first_name ?? null),
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
        instructorName: instructorProfile
          ? `${instructorProfile.first_name} ${instructorProfile.last_name}`
          : null,
        instructorEmail: instructorProfile?.email ?? null,
        instructorPhone: instructorProfile?.phone ?? null,
        addons: resolvedAddons.map((a) => ({ name: a.name, price: a.price })),
      });

      const { error: emailError } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: resolvedCustomerEmail,
        subject,
        html,
      });

      if (emailError) {
        console.error("[bookings/confirm] Confirmation email failed:", {
          bookingId,
          error: emailError,
        });
      }

      // Notify the instructor of the new booking (best-effort — non-fatal).
      if (instructorProfile?.email && typeof startsAt === "string") {
        const customerFullName = [
          typeof customerFirstName === "string" && customerFirstName
            ? customerFirstName
            : (customerProfile?.first_name ?? ""),
          customerProfile?.last_name ?? "",
        ]
          .join(" ")
          .trim() || "Unknown";

        const { subject: iSubject, html: iHtml } = instructorBookingNotificationEmail({
          instructorFirstName: instructorProfile.first_name,
          customerName: customerFullName,
          className: typeof className === "string" ? className : "CPR Class",
          startsAt,
          locationName: typeof locationName === "string" ? locationName : "",
          source: appliedPromoCode ? "promo" : "online",
        });

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL!,
          to: instructorProfile.email,
          subject: iSubject,
          html: iHtml,
        }).catch((err: unknown) => {
          console.error("[bookings/confirm] Instructor notification email failed:", { bookingId, error: err });
        });
      }
    }
  }

  return Response.json({ success: true, bookingId });
}
