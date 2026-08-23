/**
 * POST /api/paypal/capture-manual-charge
 * Called by: admin session manual charge modal after PayPal card approval.
 * Auth: Manager and super_admin only
 * Captures the PayPal order and logs the completed payment. Always credited to
 * the session's assigned instructor (via instructor_earnings), regardless of
 * whether a booking was ever created for the charged customer — this is
 * payment for that class whether or not the customer ends up attending.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import {
  getPayPalAccessToken,
  getPayPalApiBase,
  evaluateCaptureOutcome,
  classifyCaptureRequestError,
  type CaptureOutcome,
} from "@/lib/paypal";
import { recordBookingEarning } from "@/lib/instructor-earnings";
import { isMockPaymentsEnabled, mockCaptureOutcome } from "@/lib/mock-payments";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;

  const body = await request.json().catch(() => null);
  if (!isObject(body)) {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { paypalOrderId, sessionId, customerId, amount, description, notes } = body;
  if (typeof paypalOrderId !== "string" || !paypalOrderId.trim()) {
    return Response.json({ success: false, error: "Missing PayPal order ID." }, { status: 400 });
  }
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return Response.json({ success: false, error: "Missing session ID." }, { status: 400 });
  }
  if (typeof customerId !== "string" || !customerId.trim()) {
    return Response.json({ success: false, error: "Missing customer ID." }, { status: 400 });
  }

  const parsedAmount = typeof amount === "number" ? amount : parseFloat(String(amount));
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return Response.json({ success: false, error: "A valid positive amount is required." }, { status: 400 });
  }

  const descriptionText =
    typeof description === "string" && description.trim()
      ? description.trim()
      : "Manual card charge";
  const notesText = typeof notes === "string" && notes.trim() ? notes.trim() : null;

  const adminClient = await createAdminClient();

  // ── Resolve the session's instructor up front — fail before charging the card ──
  // if we can't attribute this money to anyone, rather than capturing payment
  // and then silently losing the accounting trail.
  const { data: sessionRow, error: sessionError } = await adminClient
    .from("class_sessions")
    .select("instructor_id, class_types(name)")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    console.error("[capture-manual-charge] Session lookup failed:", sessionError);
    return Response.json({ success: false, error: "Failed to load session." }, { status: 500 });
  }
  if (!sessionRow) {
    return Response.json({ success: false, error: "Session not found." }, { status: 404 });
  }
  if (!sessionRow.instructor_id) {
    return Response.json(
      { success: false, error: "This session has no assigned instructor yet — assign one before charging a manual payment." },
      { status: 422 }
    );
  }

  const instructorId = sessionRow.instructor_id;
  const classTypeJoin = (
    sessionRow as { class_types: { name: string | null } | { name: string | null }[] | null }
  ).class_types;
  const classType = Array.isArray(classTypeJoin) ? classTypeJoin[0] : classTypeJoin;
  const className = classType?.name?.trim() || "CPR Class";

  // See lib/mock-payments.ts. When active, no PayPal call happens at all —
  // the rest of this route runs unmodified against a synthesized outcome.
  const mockMode = isMockPaymentsEnabled();
  let outcome: CaptureOutcome;

  if (mockMode) {
    console.log("[capture-manual-charge] MOCK PAYMENTS active — synthesizing a settled capture", {
      sessionId,
      customerId,
      amount: parsedAmount,
    });
    outcome = mockCaptureOutcome(parsedAmount);
  } else {
    const accessToken = await getPayPalAccessToken();
    const captureResponse = await fetch(
      `${getPayPalApiBase()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!captureResponse.ok) {
      const errorText = await captureResponse.text().catch(() => "Unknown capture error");
      console.error("[capture-manual-charge] PayPal capture failed:", errorText);

      // See classifyCaptureRequestError in lib/paypal.ts — PayPal rejects a
      // declined card at the HTTP level too (422 PAYMENT_DENIED), a separate
      // failure shape from the DECLINED-in-body case evaluateCaptureOutcome
      // handles below.
      const { declined } = classifyCaptureRequestError(errorText);
      if (declined) {
        return Response.json(
          {
            success: false,
            declined: true,
            error: "The card was declined and no payment was taken. Please try another card.",
          },
          { status: 402 }
        );
      }

      return Response.json({ success: false, error: "Payment capture failed." }, { status: 502 });
    }

    const captureData = await captureResponse.json();
    outcome = evaluateCaptureOutcome(captureData);
  }

  if (!outcome.settled) {
    console.error("[capture-manual-charge] Capture did not settle:", {
      paypalOrderId,
      status: outcome.status,
      captureId: outcome.captureId,
    });

    return Response.json(
      {
        success: false,
        declined: true,
        error:
          outcome.status === "PENDING"
            ? "Payment is still pending review. No charge was recorded."
            : "Your card was declined and no payment was taken. Please try another card.",
      },
      { status: 402 }
    );
  }

  const paypalTransactionId = outcome.captureId;
  const fees = outcome.fees;

  // The recorded amount must be what PayPal actually captured, never the
  // client-supplied figure. Without this check a manager could create an order
  // for $1, capture it, and pass amount=100 — recording $100 phantom revenue
  // and crediting the instructor a payout on money that never arrived
  // (THREAT-055). Reject on mismatch rather than silently substituting, so a
  // buggy client is surfaced instead of papered over.
  if (
    outcome.capturedAmount !== null &&
    Math.abs(outcome.capturedAmount - parsedAmount) > 0.01
  ) {
    console.error("[capture-manual-charge] Captured amount mismatch:", {
      paypalOrderId,
      capturedAmount: outcome.capturedAmount,
      claimedAmount: parsedAmount,
    });
    return Response.json(
      {
        success: false,
        error: `Amount mismatch: PayPal captured $${outcome.capturedAmount.toFixed(2)} but $${parsedAmount.toFixed(2)} was submitted. The charge was NOT recorded — verify in PayPal before retrying.`,
      },
      { status: 409 }
    );
  }
  const recordedAmount = outcome.capturedAmount ?? parsedAmount;

  // ── Best-effort: link to an existing active booking for this customer + ──────
  // session, if the admin already used "Add Student" separately. Not required —
  // the earning is recorded against the session's instructor either way.
  const { data: existingBooking } = await adminClient
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("customer_id", customerId)
    .eq("cancelled", false)
    .maybeSingle();
  const linkedBookingId = (existingBooking as { id: string } | null)?.id ?? null;

  const baseRoutingNote = `Manual register charge — ${descriptionText} (session: ${className})`;
  const routingNote = mockMode
    ? `[MOCK PAYMENT — staging test, no funds moved] ${baseRoutingNote}`
    : baseRoutingNote;
  const { data: paymentRow, error: paymentInsertError } = await adminClient
    .from("payments")
    .insert({
      customer_id: customerId,
      booking_id: linkedBookingId,
      amount: recordedAmount,
      status: "completed",
      payment_type: "online",
      paypal_transaction_id: paypalTransactionId,
      routing_note: routingNote,
      notes: notesText,
      paypal_fee_amount: fees.paypalFee,
      net_amount: fees.netAmount,
    })
    .select("id")
    .single();

  if (paymentInsertError) {
    console.error("[capture-manual-charge] Failed to insert payment record:", paymentInsertError);
    return Response.json({ success: false, error: "Failed to record payment." }, { status: 500 });
  }

  // ── Credit the session's instructor and record the platform's cut ──────────
  // Same accounting path as a normal online booking (recordBookingEarning),
  // just without a bookingId when "Add Student" was never clicked — see the
  // comment on BookingEarningParams.bookingId for why that's intentional.
  //
  // Skipped entirely in mock mode: see lib/mock-payments.ts — staging's
  // scheduled payout cron would eventually submit any unbatched earning row
  // to real PayPal Payouts, and a mock charge has no real money behind it.
  if (mockMode) {
    console.log("[capture-manual-charge] MOCK PAYMENTS — skipping instructor earning (would risk a real payout for a fabricated charge)");
  } else {
    await recordBookingEarning(adminClient, {
      instructorId,
      bookingId: linkedBookingId,
      paymentId: (paymentRow as { id?: string } | null)?.id ?? null,
      grossAmount: recordedAmount,
      note: routingNote,
    }).catch((err: unknown) => {
      console.error("[capture-manual-charge] CRITICAL: instructor earning insert failed", {
        sessionId,
        instructorId,
        paypalTransactionId,
        amount: recordedAmount,
        error: err,
      });
    });
  }

  return Response.json({ success: true, mock: mockMode });
}
