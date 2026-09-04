/**
 * POST /api/sessions/[id]/charge-and-book
 * Called by: the "Add Student to Class" modal on /admin/sessions/[id].
 * Auth: instructor (own session only), manager, super_admin.
 *
 * Charges a card and creates the booking as ONE server-side operation. Unlike
 * the manager-only pair (/api/paypal/capture-manual-charge + /api/customers/
 * [id]/add-booking), which are deliberately independent, this route cannot add
 * a student without money settling first: the booking is only created after a
 * COMPLETED capture, and a capture whose booking then fails is refunded.
 *
 * That asymmetry is the entire point. Instructors get the same modal managers
 * see, minus the standalone "Add" button, so the only path they have to a new
 * booking runs through a real payment.
 *
 * The amount is instructor-entered rather than derived from the class price —
 * walk-in and negotiated rates differ from the catalog. The session's list
 * price is still resolved server-side and stamped into the booking's audit
 * note, so an off-price charge is visible on the booking itself rather than
 * only in PayPal.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import {
  getPayPalAccessToken,
  getPayPalApiBase,
  evaluateCaptureOutcome,
  classifyCaptureRequestError,
  refundCapture,
  type CaptureOutcome,
} from "@/lib/paypal";
import { recordBookingEarning } from "@/lib/instructor-earnings";
import { maybeTriggerImmediatePayout } from "@/lib/payout-trigger";
import { maybeSendAssistantReminder } from "@/lib/assistant-reminder";
import { getSessionPricing } from "@/lib/session-pricing";
import { logPaymentFailure, describeBookSpotFailure } from "@/lib/payment-failures";
import { floatingNow } from "@/lib/business-time";
import { sendEmail, isEmailConfigured } from "@/lib/send-email";
import { bookingConfirmationEmail, instructorBookingNotificationEmail } from "@/lib/emails";
import { isMockPaymentsEnabled, mockCaptureOutcome } from "@/lib/mock-payments";

/** Acceptable rounding tolerance when comparing captured and submitted amounts. */
const AMOUNT_TOLERANCE = 0.01;

/**
 * Upper bound on a single manual charge. No class costs this much — the limit
 * exists to catch a decimal slip (7500 for 75.00) before it reaches a customer's
 * card, not to constrain legitimate pricing.
 */
const MAX_CHARGE_AMOUNT = 2500;

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Unwraps a PostgREST embedded relation, which is an object or a 1-element array. */
function firstRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Captures a card payment and books the customer into the session atomically.
 * @param request - POST body: { paypalOrderId, customerId, amount, description?, notes? }
 * @param params - Route params containing the class_sessions UUID.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const auth = await requireApiRole(["instructor", "manager", "super_admin"]);
  if ("error" in auth) return auth.error;
  const actor = auth.actor;

  const { id: sessionId } = await params;

  const body = await request.json().catch(() => null);
  if (!isObject(body)) {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { paypalOrderId, customerId, amount, description, notes } = body;

  if (typeof paypalOrderId !== "string" || !paypalOrderId.trim()) {
    return Response.json({ success: false, error: "Missing PayPal order ID." }, { status: 400 });
  }
  if (typeof customerId !== "string" || !customerId.trim()) {
    return Response.json({ success: false, error: "Missing customer ID." }, { status: 400 });
  }

  const parsedAmount = typeof amount === "number" ? amount : parseFloat(String(amount));
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return Response.json(
      { success: false, error: "A valid positive amount is required." },
      { status: 400 }
    );
  }
  if (parsedAmount > MAX_CHARGE_AMOUNT) {
    return Response.json(
      {
        success: false,
        error: `Amount exceeds the $${MAX_CHARGE_AMOUNT.toLocaleString()} manual charge limit — check the decimal point.`,
      },
      { status: 400 }
    );
  }

  const notesText = typeof notes === "string" && notes.trim() ? notes.trim() : null;

  const supabase = await createAdminClient();

  // ── Load the session and run every check that can fail BEFORE the card is ──
  // touched. A decline the instructor can act on is fine; a capture we then
  // have to refund because the class was full is not.
  const { data: session, error: sessionError } = await supabase
    .from("class_sessions")
    .select(
      `
      id, instructor_id, status, approval_status, starts_at, ends_at, max_capacity,
      class_types ( name ),
      locations ( name, address, city, state, zip ),
      profiles!class_sessions_instructor_id_fkey ( first_name, last_name, email, phone )
    `
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    console.error("[charge-and-book] Session lookup failed:", sessionError);
    return Response.json({ success: false, error: "Failed to load session." }, { status: 500 });
  }
  if (!session) {
    return Response.json({ success: false, error: "Session not found." }, { status: 404 });
  }

  // Instructors may only charge into their own class. Managers and super
  // admins may charge into any — same split as session cancellation.
  if (actor.effectiveRole === "instructor" && session.instructor_id !== actor.user.id) {
    return Response.json(
      { success: false, error: "You can only add students to your own classes." },
      { status: 403 }
    );
  }

  // The earning has to land somewhere. book_spot would also reject an
  // unapproved or cancelled session, but failing here keeps the card untouched.
  if (!session.instructor_id) {
    return Response.json(
      {
        success: false,
        error: "This session has no assigned instructor yet — assign one before charging.",
      },
      { status: 422 }
    );
  }
  if (session.status === "cancelled" || session.approval_status !== "approved") {
    return Response.json(
      { success: false, error: "This session is not available for booking." },
      { status: 409 }
    );
  }

  // Walk-ins at the door are the main use case, so a class that has already
  // started is fine — one that has finished is not.
  //
  // Compared against floatingNow(), not a real instant: since migration 0060
  // ends_at is a floating wall-clock value, so comparing it to `new Date()`
  // would call a 5:00 PM Eastern class finished at 1:00 PM — the UTC offset
  // early. Same reasoning as add-booking's starts_at check.
  if (session.ends_at && new Date(session.ends_at) < new Date(floatingNow())) {
    return Response.json(
      { success: false, error: "This class has already ended." },
      { status: 422 }
    );
  }

  // book_spot's duplicate guard only covers booking_source = 'online' (see the
  // partial unique index bookings_online_session_customer_unique), so a
  // 'manual' booking would happily double-book. Check it here instead.
  const { data: duplicate } = await supabase
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("customer_id", customerId)
    .eq("cancelled", false)
    .maybeSingle();

  if (duplicate) {
    return Response.json(
      { success: false, error: "This student is already booked into this class." },
      { status: 409 }
    );
  }

  // Mirror book_spot's seat math (active bookings + unpaid invoice seats) so a
  // full class is reported before the charge rather than as a refund after it.
  const [{ count: bookedCount }, { data: invoiceRows }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("cancelled", false),
    supabase
      .from("invoices")
      .select("student_count")
      .eq("class_session_id", sessionId)
      .not("status", "in", "(cancelled,paid)"),
  ]);

  const invoiceSeats = (invoiceRows ?? []).reduce(
    (sum: number, row: { student_count: number | null }) => sum + (row.student_count ?? 0),
    0
  );

  if ((bookedCount ?? 0) + invoiceSeats >= session.max_capacity) {
    return Response.json({ success: false, error: "This class is full." }, { status: 409 });
  }

  const instructorId = session.instructor_id;
  const classType = firstRelation(session.class_types as { name: string | null } | { name: string | null }[] | null);
  const className = classType?.name?.trim() || "CPR Class";
  const descriptionText =
    typeof description === "string" && description.trim()
      ? description.trim()
      : `Class payment — ${className}`;

  // Reference only. The instructor sets the price; this is resolved so an
  // off-price charge is recorded on the booking rather than being invisible.
  const pricing = await getSessionPricing(supabase, sessionId);
  const listPrice = pricing.found ? pricing.basePrice : null;

  // ── Capture the card ──────────────────────────────────────────────────────
  // See lib/mock-payments.ts. When active, no PayPal call happens at all and
  // no PayPal SDK ever loaded on the client either — the rest of this route
  // runs unmodified against a synthesized settled outcome.
  const mockMode = isMockPaymentsEnabled();
  let outcome: CaptureOutcome;

  if (mockMode) {
    console.log("[charge-and-book] MOCK PAYMENTS active — synthesizing a settled capture", {
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
      console.error("[charge-and-book] PayPal capture failed:", errorText);

      // PayPal rejects a declined card at the HTTP level (422 PAYMENT_DENIED) as
      // well as via a 2xx capture with status DECLINED — both have to be handled.
      const { declined, issue } = classifyCaptureRequestError(errorText);

      await logPaymentFailure(
        supabase,
        {
          customerId,
          amount: parsedAmount,
          // No capture exists — the order id keeps the attempt traceable in PayPal.
          paypalTransactionId: paypalOrderId,
          notes: declined
            ? `Card declined on manual charge: ${issue ?? "unspecified"}`
            : `Manual charge capture failed (HTTP ${captureResponse.status})`,
        },
        "charge-and-book"
      );

      if (declined) {
        return Response.json(
          {
            success: false,
            declined: true,
            error: "The card was declined and no payment was taken. The student was NOT added.",
          },
          { status: 402 }
        );
      }

      return Response.json({ success: false, error: "Payment capture failed." }, { status: 502 });
    }

    outcome = evaluateCaptureOutcome(await captureResponse.json());
  }

  // Nothing below this line may run unless money actually moved. A declined
  // card still returns HTTP 201 with a full amount breakdown, so the capture
  // status is the only trustworthy signal (THREAT-054).
  if (!outcome.settled) {
    console.error("[charge-and-book] Capture did not settle — no booking created", {
      sessionId,
      customerId,
      paypalOrderId,
      captureStatus: outcome.status,
    });

    await logPaymentFailure(
      supabase,
      {
        customerId,
        amount: parsedAmount,
        paypalTransactionId: outcome.captureId ?? paypalOrderId,
        notes: `Manual charge not settled: status=${outcome.status ?? "unknown"}`,
      },
      "charge-and-book"
    );

    return Response.json(
      {
        success: false,
        declined: outcome.status !== "PENDING",
        error:
          outcome.status === "PENDING"
            ? "PayPal is still reviewing this payment. The student was NOT added — wait for it to settle before retrying."
            : "The card was declined and no payment was taken. The student was NOT added.",
      },
      { status: 402 }
    );
  }

  const paypalTransactionId = outcome.captureId;
  const fees = outcome.fees;

  // Record what PayPal actually took, never the client's figure — otherwise a
  // tampered request could book a $1 charge as $100 of revenue and pay the
  // instructor out on money that never arrived (THREAT-055).
  if (
    outcome.capturedAmount !== null &&
    Math.abs(outcome.capturedAmount - parsedAmount) > AMOUNT_TOLERANCE
  ) {
    console.error("[charge-and-book] Captured amount mismatch:", {
      sessionId,
      paypalOrderId,
      capturedAmount: outcome.capturedAmount,
      claimedAmount: parsedAmount,
    });

    // Unreachable in mock mode today — mockCaptureOutcome always sets
    // capturedAmount to exactly parsedAmount — but guarded anyway so a future
    // change to that function can't accidentally send a fabricated capture id
    // to the real PayPal refund endpoint.
    if (!mockMode && paypalTransactionId) {
      await refundCapture(paypalTransactionId).catch((err: unknown) =>
        console.error("[charge-and-book] Refund after amount mismatch failed:", err)
      );
    }
    await logPaymentFailure(
      supabase,
      {
        customerId,
        amount: parsedAmount,
        paypalTransactionId,
        notes: `Captured and refunded: amount mismatch (captured $${outcome.capturedAmount.toFixed(2)}, submitted $${parsedAmount.toFixed(2)})`,
      },
      "charge-and-book"
    );

    return Response.json(
      {
        success: false,
        error: "Payment amount mismatch — the charge was reversed and the student was not added.",
      },
      { status: 409 }
    );
  }

  const chargedAmount = outcome.capturedAmount ?? parsedAmount;

  // ── Reserve the spot; refund if it cannot be taken ────────────────────────
  const { data: bookingId, error: rpcError } = await supabase.rpc("book_spot", {
    p_session_id: sessionId,
    p_customer_id: customerId,
    p_booking_source: "manual",
    p_invoice_id: null,
  });

  if (rpcError || !bookingId) {
    const msg = rpcError?.message ?? "";

    // A real refund would fail against a fabricated capture id, and there is
    // no real charge to reverse — nothing to do here in mock mode.
    if (!mockMode && paypalTransactionId) {
      await refundCapture(paypalTransactionId).catch((err: unknown) =>
        console.error("[charge-and-book] Refund after booking failure failed:", err)
      );
    }
    await logPaymentFailure(
      supabase,
      {
        customerId,
        amount: chargedAmount,
        paypalTransactionId,
        notes: `Captured and refunded: ${describeBookSpotFailure(msg)}`,
      },
      "charge-and-book"
    );

    if (msg.includes("session_full")) {
      return Response.json(
        { success: false, error: "The class filled up — the charge was refunded." },
        { status: 409 }
      );
    }
    if (msg.includes("session_unavailable")) {
      return Response.json(
        { success: false, error: "The class is no longer available — the charge was refunded." },
        { status: 410 }
      );
    }
    if (msg.includes("session_not_found")) {
      return Response.json(
        { success: false, error: "Session not found — the charge was refunded." },
        { status: 404 }
      );
    }

    console.error("[charge-and-book] book_spot failed:", rpcError);
    return Response.json(
      { success: false, error: "Could not add the student — the charge was refunded." },
      { status: 500 }
    );
  }

  // ── Audit stamp ───────────────────────────────────────────────────────────
  // book_spot cannot set these, so they are written straight after. Recording
  // the list price next to the charged amount is what makes an off-price
  // manual charge visible on the booking itself.
  const priceNote =
    listPrice !== null && Math.abs(listPrice - chargedAmount) > AMOUNT_TOLERANCE
      ? ` (list price $${listPrice.toFixed(2)})`
      : "";
  const mockNote = mockMode ? "[MOCK PAYMENT — staging test, no funds moved] " : "";
  const reason =
    `${mockNote}Added and charged $${chargedAmount.toFixed(2)}${priceNote} by ` +
    `${actor.profile.first_name} ${actor.profile.last_name} from the session page.`;

  const { error: stampError } = await supabase
    .from("bookings")
    .update({ created_by: actor.user.id, manual_booking_reason: reason })
    .eq("id", bookingId);

  if (stampError) {
    // Non-fatal: the student is booked and paid. Only the audit trail suffers.
    console.error("[charge-and-book] Failed to stamp booking audit fields:", {
      bookingId,
      error: stampError,
    });
  }

  // ── Payment + instructor earning ──────────────────────────────────────────
  const routingNote = `${mockNote}Manual card charge at class — ${descriptionText}${priceNote}`;

  const { data: paymentRow, error: paymentInsertError } = await supabase
    .from("payments")
    .insert({
      customer_id: customerId,
      booking_id: bookingId,
      amount: chargedAmount,
      status: "completed",
      payment_type: "online",
      paypal_transaction_id: paypalTransactionId,
      routing_note: routingNote,
      notes: notesText,
      // Null when PayPal omitted the breakdown — null means "not tracked", not zero.
      paypal_fee_amount: fees.paypalFee,
      net_amount: fees.netAmount,
    })
    .select("id")
    .single();

  // The booking exists and the card was charged — do not fail the response over
  // a bookkeeping insert. Log loudly so ops can reconcile.
  if (paymentInsertError) {
    console.error("[charge-and-book] CRITICAL: payment record insert failed", {
      bookingId,
      paypalTransactionId,
      amount: chargedAmount,
      error: paymentInsertError,
    });
  }

  // Credited to the session's instructor, which is who taught the class —
  // the same rule capture-manual-charge uses, and identical for the common
  // case where the instructor charged their own student.
  //
  // Skipped entirely in mock mode: see lib/mock-payments.ts — staging's
  // scheduled payout cron would eventually submit any unbatched earning row
  // to real PayPal Payouts, and a mock charge has no real money behind it.
  if (mockMode) {
    console.log("[charge-and-book] MOCK PAYMENTS — skipping instructor earning (would risk a real payout for a fabricated charge)");
  } else {
    await recordBookingEarning(supabase, {
      instructorId,
      bookingId: bookingId as string,
      paymentId: (paymentRow as { id?: string } | null)?.id ?? null,
      grossAmount: chargedAmount,
      note: routingNote,
    }).catch((err: unknown) => {
      console.error("[charge-and-book] CRITICAL: instructor earning insert failed", {
        bookingId,
        instructorId,
        paypalTransactionId,
        amount: chargedAmount,
        error: err,
      });
    });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
  await maybeSendAssistantReminder(supabase, sessionId, baseUrl).catch((err: unknown) => {
    console.error("[charge-and-book] Assistant reminder check failed (non-fatal):", err);
  });
  // No earning was created above in mock mode, so there is nothing new for a
  // payout trigger to pick up — skipped to avoid a pointless real HTTP call
  // to the payout route on every test charge.
  if (!mockMode) {
    await maybeTriggerImmediatePayout(supabase);
  }

  // ── Confirmation emails (best-effort) ─────────────────────────────────────
  // Skipped entirely in mock mode: Resend on staging is the same real
  // account, and nobody should get "you were charged $75" for a test run.
  if (!mockMode && isEmailConfigured()) {
    const location = firstRelation(
      session.locations as
        | { name: string; address: string; city: string; state: string; zip: string }
        | { name: string; address: string; city: string; state: string; zip: string }[]
        | null
    );
    const instructorProfile = firstRelation(
      session.profiles as
        | { first_name: string; last_name: string; email: string | null; phone: string | null }
        | { first_name: string; last_name: string; email: string | null; phone: string | null }[]
        | null
    );

    const { data: customerProfile } = await supabase
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", customerId)
      .maybeSingle();

    if (!customerProfile?.email) {
      console.error("[charge-and-book] No email on file — confirmation not sent", {
        bookingId,
        customerId,
      });
    } else {
      try {
        const { subject, html } = bookingConfirmationEmail({
          firstName: customerProfile.first_name ?? null,
          className,
          startsAt: session.starts_at,
          locationName: location?.name ?? "",
          locationAddress: location?.address ?? "",
          locationCity: location?.city ?? "",
          locationState: location?.state ?? "",
          locationZip: location?.zip ?? "",
          amount: chargedAmount,
          paymentProcessor: "SuperHeroCPR via PayPal",
          transactionId: paypalTransactionId,
          instructorName: instructorProfile
            ? `${instructorProfile.first_name} ${instructorProfile.last_name}`
            : null,
          instructorEmail: instructorProfile?.email ?? null,
          instructorPhone: instructorProfile?.phone ?? null,
        });

        await sendEmail({
          context: "charge-and-book:customer",
          to: customerProfile.email,
          subject,
          html,
          idempotencyKey: `charge-and-book-customer-${bookingId}`,
        });
      } catch (err) {
        // Guards the template build above — sendEmail never throws.
        console.error("[charge-and-book] Confirmation email could not be prepared:", err);
      }
    }

    // Skip the instructor notification when the instructor is the one who just
    // added the student — they were standing right there.
    if (instructorProfile?.email && instructorId !== actor.user.id) {
      try {
        const customerFullName =
          [customerProfile?.first_name ?? "", customerProfile?.last_name ?? ""]
            .join(" ")
            .trim() || "Unknown";

        const { subject, html } = instructorBookingNotificationEmail({
          instructorFirstName: instructorProfile.first_name,
          customerName: customerFullName,
          className,
          startsAt: session.starts_at,
          locationName: location?.name ?? "",
          source: "manual",
        });

        await sendEmail({
          context: "charge-and-book:instructor",
          to: instructorProfile.email,
          subject,
          html,
          idempotencyKey: `charge-and-book-instructor-${bookingId}`,
        });
      } catch (err) {
        // Guards the template build above — sendEmail never throws.
        console.error("[charge-and-book] Instructor notification could not be prepared:", err);
      }
    }
  } else if (mockMode) {
    console.log("[charge-and-book] MOCK PAYMENTS — skipping confirmation and instructor notification emails");
  }

  return Response.json({ success: true, bookingId, amount: chargedAmount, mock: mockMode });
}
