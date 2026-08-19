/**
 * POST /api/team-bookings/[share_token]/signup
 * Called by: TeamSignupClient (public /team/<token> page)
 * Auth: the employee's own Supabase session — they must be signed in, which is
 *   what puts a real, named profile behind the booking so RollCall works on
 *   class day. The share token authorises access to the class; the session
 *   authorises acting as that person.
 *
 * Two paths, decided by the team booking's payment mode (read from the DB,
 * never from the request):
 *   - 'company'  → the company already covers the class. Reserve the spot via
 *                  book_spot and record a $0 payment. No PayPal involved.
 *   - 'per_seat' → capture payment first, then reserve. Mirrors the ordering of
 *                  /api/bookings/confirm exactly: re-price server-side,
 *                  re-validate the promo code, capture, require a settled
 *                  capture, book, record payment + instructor earning, and
 *                  refund automatically if anything after the capture fails.
 *
 * Add-ons are never offered on team bookings, so there is no add-on handling.
 * Bookings keep booking_source = 'online' so book_spot's duplicate guard and
 * the bookings_online_session_customer_unique index prevent an employee
 * signing up for the same class twice.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getTeamBookingByShareToken } from "@/lib/team-bookings";
import { getSessionPricing } from "@/lib/session-pricing";
import { resolvePromoDiscount } from "@/lib/promo-codes";
import {
  getPayPalAccessToken,
  getPayPalApiBase,
  evaluateCaptureOutcome,
  classifyCaptureRequestError,
} from "@/lib/paypal";
import { recordBookingEarning } from "@/lib/instructor-earnings";
import { maybeTriggerImmediatePayout } from "@/lib/payout-trigger";
import { maybeSendAssistantReminder } from "@/lib/assistant-reminder";
import {
  logPaymentFailure,
  describeBookSpotFailure,
  isLoggableCaptureFailure,
} from "@/lib/payment-failures";
import { Resend } from "resend";
import { teamSignupConfirmationEmail, instructorBookingNotificationEmail } from "@/lib/emails";
import { NextResponse } from "next/server";

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
  const res = await fetch(`${getPayPalApiBase()}/v2/payments/captures/${captureId}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Refund failed: ${res.status} ${txt}`);
  }
}

/**
 * Maps a book_spot RPC failure to a user-facing response.
 * @param message - The raw RPC error message.
 * @param refunded - Whether a payment was already refunded, for wording.
 * @returns The response to return to the caller.
 */
function bookSpotErrorResponse(message: string, refunded: boolean): Response {
  const suffix = refunded ? " Payment refunded." : "";
  if (message.includes("already_booked")) {
    return NextResponse.json(
      { error: `You're already signed up for this class.${suffix}` },
      { status: 409 }
    );
  }
  if (message.includes("session_full")) {
    return NextResponse.json(
      { error: `This class just filled up.${suffix}` },
      { status: 409 }
    );
  }
  if (message.includes("session_unavailable")) {
    return NextResponse.json(
      { error: `This class is no longer available.${suffix}` },
      { status: 410 }
    );
  }
  if (message.includes("session_not_found")) {
    return NextResponse.json({ error: `Class not found.${suffix}` }, { status: 404 });
  }
  return NextResponse.json(
    { error: `Failed to complete signup.${suffix}` },
    { status: 500 }
  );
}

/**
 * Handles an employee signing themselves up through a team link.
 * @param request - Incoming request; body carries the optional promo code and
 *   (per-seat mode only) the PayPal order id and client-computed amount.
 * @param context - Route params containing the share token.
 * @returns JSON with `{ data: { bookingId } }` or `{ error }` and a status code.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ share_token: string }> }
): Promise<Response> {
  const { share_token: shareToken } = await context.params;

  // ── Authenticate the employee ────────────────────────────────────────────
  // Their own cookie-bound session — a booking must belong to a real profile so
  // the roster and RollCall show the right person.
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Please sign in or create an account to reserve your spot." },
      { status: 401 }
    );
  }

  const supabase = await createAdminClient();

  // ── Resolve the team booking from the token (server-side authority) ──────
  const team = await getTeamBookingByShareToken(supabase, shareToken);
  if (!team) {
    return NextResponse.json({ error: "This signup link is not valid." }, { status: 404 });
  }

  if (team.closed) {
    const message =
      team.closedReason === "full"
        ? "This class is full."
        : team.closedReason === "cancelled"
          ? "This class has been cancelled."
          : team.closedReason === "past"
            ? "This class has already started."
            : "This class isn't open for signups yet. Please check back shortly.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is valid for company-paid signups.
  }
  const parsedBody = isObject(body) ? body : {};

  const { sessionId } = team;

  // ── Company-paid: no money changes hands here ───────────────────────────
  if (team.paymentMode === "company") {
    const { data: bookingId, error: rpcError } = await supabase.rpc("book_spot", {
      p_session_id: sessionId,
      p_customer_id: user.id,
      p_booking_source: "online",
      p_invoice_id: null,
    });

    if (rpcError || !bookingId) {
      return bookSpotErrorResponse(rpcError?.message ?? "", false);
    }

    await finaliseSignup(supabase, {
      bookingId: bookingId as string,
      customerId: user.id,
      team,
      amount: 0,
      paypalTransactionId: null,
      paypalFee: null,
      netAmount: null,
      routingNote: `Team booking — ${team.companyName} (company-paid, invoiced separately)`,
      paymentType: "invoice",
      promoCode: null,
    });

    return NextResponse.json({ data: { bookingId } }, { status: 201 });
  }

  // ── Per-seat: employee pays now ─────────────────────────────────────────
  const { paypalOrderId, amount, promoCode } = parsedBody;

  // Step 1: re-price server-side (THREAT-013). The per-seat rate comes from the
  // team_bookings row the token points at — never from the request body.
  const pricing = await getSessionPricing(supabase, sessionId, {
    teamPricePerSeat: team.pricePerSeat,
  });

  if (!pricing.found) {
    console.error("[team-signup] Session pricing lookup failed:", pricing.error);
    return NextResponse.json({ error: pricing.error }, { status: 500 });
  }

  let expectedPrice = pricing.basePrice;
  let appliedPromoCode: string | null = null;
  let discountAmount = 0;

  if (typeof promoCode === "string" && promoCode.trim()) {
    const promoResult = await resolvePromoDiscount(
      supabase,
      promoCode.trim(),
      sessionId,
      pricing.basePrice
    );
    if (!promoResult.valid) {
      return NextResponse.json(
        { error: `Promo code invalid: ${promoResult.error}` },
        { status: 422 }
      );
    }
    expectedPrice = promoResult.finalPrice;
    appliedPromoCode = promoResult.code;
    discountAmount = promoResult.discountAmount;
  }

  // ── Free after discount: skip PayPal entirely ────────────────────────────
  // Either the staff quoted the seat at $0 or a 100%-off promo zeroed it out.
  // PayPal rejects $0 orders, so requiring an order id here would make a fully
  // discounted team seat impossible to claim. The decision is made from the
  // server-computed price, never from a client-supplied amount.
  if (expectedPrice <= 0) {
    const { data: freeBookingId, error: freeRpcError } = await supabase.rpc("book_spot", {
      p_session_id: sessionId,
      p_customer_id: user.id,
      p_booking_source: "online",
      p_invoice_id: null,
    });

    if (freeRpcError || !freeBookingId) {
      return bookSpotErrorResponse(freeRpcError?.message ?? "", false);
    }

    await finaliseSignup(supabase, {
      bookingId: freeBookingId as string,
      customerId: user.id,
      team,
      amount: 0,
      paypalTransactionId: null,
      paypalFee: null,
      netAmount: null,
      routingNote: appliedPromoCode
        ? `Team booking — ${team.companyName} (per-seat, free via promo ${appliedPromoCode})`
        : `Team booking — ${team.companyName} (per-seat, no charge)`,
      paymentType: "promo",
      promoCode: appliedPromoCode,
    });

    return NextResponse.json({ data: { bookingId: freeBookingId } }, { status: 201 });
  }

  if (typeof paypalOrderId !== "string" || !paypalOrderId || typeof amount !== "number") {
    return NextResponse.json(
      { error: "Missing payment details. Please try again." },
      { status: 400 }
    );
  }

  if (Math.abs(amount - expectedPrice) > PRICE_TOLERANCE) {
    return NextResponse.json(
      { error: "Pricing has changed. Please refresh and try again." },
      { status: 409 }
    );
  }

  // Step 2: capture the PayPal payment server-side.
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
    console.error("[team-signup] PayPal capture failed:", errorText);

    const { declined, issue } = classifyCaptureRequestError(errorText);

    // An unapproved or fabricated order id is not a real payment attempt and
    // would only add noise to the admin payments page.
    if (isLoggableCaptureFailure(issue)) {
      await logPaymentFailure(
        supabase,
        {
          customerId: user.id,
          amount: expectedPrice,
          // No capture exists yet — record the order id so the attempt can
          // still be traced back to a PayPal order in the merchant dashboard.
          paypalTransactionId: paypalOrderId,
          notes: declined
            ? `Card declined: ${issue ?? "unspecified"}`
            : `Payment capture failed (HTTP ${captureResponse.status})`,
        },
        "team-signup"
      );
    }

    if (declined) {
      return NextResponse.json(
        {
          declined: true,
          error: "Your card was declined and no payment was taken. Please try a different card.",
        },
        { status: 402 }
      );
    }
    return NextResponse.json({ error: "Payment capture failed" }, { status: 502 });
  }

  const captureData = await captureResponse.json();

  // Step 2a: reject any capture that did not actually settle (THREAT-054).
  // A declined card still returns HTTP 201, so capture.status === "COMPLETED"
  // is the only reliable signal that money moved.
  const outcome = evaluateCaptureOutcome(captureData);

  if (!outcome.settled) {
    console.error("[team-signup] Capture did not settle — no booking created", {
      paypalOrderId,
      sessionId,
      customerId: user.id,
      captureStatus: outcome.status,
    });
    const isPending = outcome.status === "PENDING";

    await logPaymentFailure(
      supabase,
      {
        customerId: user.id,
        amount: expectedPrice,
        paypalTransactionId: outcome.captureId ?? paypalOrderId,
        notes: `Capture not settled: status=${outcome.status ?? "unknown"}${
          outcome.processorResponseCode ? ` (processor ${outcome.processorResponseCode})` : ""
        }`,
      },
      "team-signup"
    );

    return NextResponse.json(
      {
        declined: !isPending,
        error: isPending
          ? "Your payment is still being reviewed by PayPal and hasn't completed. Your spot is not yet reserved — please contact us before trying again."
          : "Your card was declined and no payment was taken. Please try a different card or payment method.",
      },
      { status: 402 }
    );
  }

  const paypalTransactionId = outcome.captureId;

  // Defence in depth — verify PayPal captured the amount we expected.
  if (outcome.capturedAmount !== null) {
    if (Math.abs(outcome.capturedAmount - expectedPrice) > PRICE_TOLERANCE) {
      if (paypalTransactionId) {
        await refundCapture(paypalTransactionId).catch((err) =>
          console.error("[team-signup] Refund after amount mismatch failed:", err)
        );
      }
      await logPaymentFailure(
        supabase,
        {
          customerId: user.id,
          amount: expectedPrice,
          paypalTransactionId,
          notes: `Captured and refunded: amount mismatch (captured $${outcome.capturedAmount.toFixed(2)}, expected $${expectedPrice.toFixed(2)})`,
        },
        "team-signup"
      );

      return NextResponse.json(
        { error: "Payment amount mismatch — transaction reversed." },
        { status: 502 }
      );
    }
  }

  // Step 3: reserve the spot. Any failure here refunds the capture.
  const { data: bookingId, error: rpcError } = await supabase.rpc("book_spot", {
    p_session_id: sessionId,
    p_customer_id: user.id,
    p_booking_source: "online",
    p_invoice_id: null,
  });

  if (rpcError || !bookingId) {
    const msg = rpcError?.message ?? "";
    if (paypalTransactionId) {
      await refundCapture(paypalTransactionId).catch((err) =>
        console.error("[team-signup] Refund after booking failure failed:", err)
      );
    }

    await logPaymentFailure(
      supabase,
      {
        customerId: user.id,
        amount: expectedPrice,
        paypalTransactionId,
        notes: `Captured and refunded: ${describeBookSpotFailure(msg)}`,
      },
      "team-signup"
    );

    return bookSpotErrorResponse(msg, true);
  }

  const routingNote = appliedPromoCode
    ? `Team booking — ${team.companyName} (per-seat, promo: ${appliedPromoCode}, discount: $${discountAmount.toFixed(2)})`
    : `Team booking — ${team.companyName} (per-seat)`;

  await finaliseSignup(supabase, {
    bookingId: bookingId as string,
    customerId: user.id,
    team,
    amount: expectedPrice,
    paypalTransactionId,
    paypalFee: outcome.fees.paypalFee,
    netAmount: outcome.fees.netAmount,
    routingNote,
    paymentType: "online",
    promoCode: appliedPromoCode,
    instructorId: pricing.instructorId,
  });

  return NextResponse.json({ data: { bookingId } }, { status: 201 });
}

/**
 * Shared post-booking work for both payment paths: stamps the team link onto
 * the booking, records the payment, records instructor earnings for paid seats,
 * and sends the confirmation emails.
 *
 * Every step is best-effort and logged rather than thrown — the spot is already
 * reserved and (for per-seat) the card already charged, so failing the response
 * here would only confuse the employee.
 *
 * Side effects: UPDATE bookings, INSERT payments, instructor earnings insert,
 * possible payout trigger, and two Resend emails.
 *
 * @param supabase - Admin Supabase client (RLS-bypassing).
 * @param args - The new booking, buyer, team context, and payment details.
 */
async function finaliseSignup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  args: {
    bookingId: string;
    customerId: string;
    team: NonNullable<Awaited<ReturnType<typeof getTeamBookingByShareToken>>>;
    amount: number;
    paypalTransactionId: string | null;
    paypalFee: number | null;
    netAmount: number | null;
    routingNote: string;
    paymentType: "online" | "invoice" | "promo";
    promoCode: string | null;
    instructorId?: string;
  }
): Promise<void> {
  const { team } = args;

  // Mark the booking as having come through the team link. Reporting only —
  // booking_source stays 'online' so the duplicate guard keeps applying.
  const { error: linkError } = await supabase
    .from("bookings")
    .update({ team_booking_id: team.teamBookingId })
    .eq("id", args.bookingId);

  if (linkError) {
    console.error("[team-signup] Failed to stamp team_booking_id (non-fatal):", {
      bookingId: args.bookingId,
      error: linkError,
    });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
  await maybeSendAssistantReminder(supabase, team.sessionId, baseUrl).catch((err: unknown) => {
    console.error("[team-signup] Assistant reminder check failed (non-fatal):", err);
  });

  const { data: paymentRow, error: paymentError } = await supabase
    .from("payments")
    .insert({
      customer_id: args.customerId,
      booking_id: args.bookingId,
      amount: args.amount,
      status: "completed",
      payment_type: args.paymentType,
      paypal_transaction_id: args.paypalTransactionId,
      routing_note: args.routingNote,
      paypal_fee_amount: args.paypalFee,
      net_amount: args.netAmount,
    })
    .select("id")
    .single();

  if (paymentError) {
    console.error("[team-signup] CRITICAL: payment record insert failed", {
      bookingId: args.bookingId,
      paypalTransactionId: args.paypalTransactionId,
      error: paymentError,
    });
  }

  // Company-paid seats earn nothing here — the instructor is paid from the
  // company invoice when it settles, via the normal invoice earnings path.
  if (args.paymentType === "online" && args.instructorId) {
    await recordBookingEarning(supabase, {
      instructorId: args.instructorId,
      bookingId: args.bookingId,
      paymentId: (paymentRow as { id?: string } | null)?.id ?? null,
      grossAmount: args.amount,
      note: args.routingNote,
    }).catch((err: unknown) => {
      console.error("[team-signup] CRITICAL: instructor earning insert failed", {
        bookingId: args.bookingId,
        error: err,
      });
    });

    await maybeTriggerImmediatePayout(supabase);
  }

  // ── Emails (best-effort) ────────────────────────────────────────────────
  if (!process.env.RESEND_API_KEY) return;

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data: customerProfile } = await supabase
    .from("profiles")
    .select("first_name, last_name, email")
    .eq("id", args.customerId)
    .maybeSingle();

  if (customerProfile?.email) {
    const { subject, html } = teamSignupConfirmationEmail({
      firstName: customerProfile.first_name ?? null,
      companyName: team.companyName,
      className: team.className,
      startsAt: team.startsAt,
      locationName: team.locationName,
      locationAddress: team.locationAddress,
      locationCity: team.locationCity,
      locationState: team.locationState,
      locationZip: team.locationZip,
      amountPaid: args.amount,
      companyPaid: team.paymentMode === "company",
      instructorName: team.instructorName,
      cancellationPhone: team.cancellationPhone,
    });

    await resend.emails
      .send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: customerProfile.email,
        subject,
        html,
      })
      .catch((err: unknown) => {
        console.error("[team-signup] Confirmation email failed:", err);
      });
  }

  // Notify the instructor, same as any other booking.
  const { data: sessionRow } = await supabase
    .from("class_sessions")
    .select("instructor_id")
    .eq("id", team.sessionId)
    .maybeSingle();

  if (!sessionRow?.instructor_id) return;

  const { data: instructorProfile } = await supabase
    .from("profiles")
    .select("first_name, email")
    .eq("id", sessionRow.instructor_id)
    .maybeSingle();

  if (!instructorProfile?.email) return;

  const customerFullName =
    [customerProfile?.first_name ?? "", customerProfile?.last_name ?? ""].join(" ").trim() ||
    "Unknown";

  const { subject, html } = instructorBookingNotificationEmail({
    instructorFirstName: instructorProfile.first_name,
    customerName: customerFullName,
    className: team.className,
    startsAt: team.startsAt,
    locationName: team.locationName,
    source: args.promoCode ? "promo" : "online",
  });

  await resend.emails
    .send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: instructorProfile.email,
      subject,
      html,
    })
    .catch((err: unknown) => {
      console.error("[team-signup] Instructor notification email failed:", err);
    });
}
