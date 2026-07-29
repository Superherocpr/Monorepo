/**
 * POST /api/bookings/confirm-free
 * Called by: book/payment page when a promo code makes the session free ($0 due).
 * Auth: None required — promo code and session ID are the verification.
 *
 * Used exclusively for bookings where a promo code reduces the price to $0.
 * PayPal is skipped entirely since no money changes hands. The promo code is
 * re-validated server-side before any booking is created. Rejects the request
 * if any add-ons were selected — those always cost money, so they go through
 * the normal /api/bookings/confirm PayPal flow instead.
 *
 * 1. Validates required fields.
 * 2. Re-fetches session price from the DB and re-validates the promo code,
 *    confirming it produces a $0 final price (THREAT-013 defense-in-depth).
 * 3. Atomically reserves a spot via book_spot RPC (THREAT-006), which also
 *    rejects a duplicate booking attempt for the same customer + session
 *    (THREAT-047).
 * 4. Creates a $0 payment record with payment_type = 'promo'.
 * 5. Sends booking confirmation email noting the promo code (best-effort).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { bookingConfirmationEmail } from "@/lib/emails";
import { resolvePromoDiscount } from "@/lib/promo-codes";
import { maybeSendAssistantReminder } from "@/lib/assistant-reminder";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Books a free session using a 100%-off promo code, bypassing PayPal entirely.
 * @param request - JSON body with sessionId, customerId, promoCode, and email display fields.
 * @returns { success: true, bookingId } on success, or { success: false, error } on failure.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const {
    sessionId,
    customerId,
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
    typeof sessionId !== "string" ||
    typeof customerId !== "string" ||
    typeof promoCode !== "string" ||
    !promoCode.trim()
  ) {
    return Response.json({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  // Add-ons always cost money — this route is only for bookings where the
  // total is genuinely $0, so any add-on selection must go through the normal
  // PayPal flow (/api/bookings/confirm) instead, even if the class itself is free.
  if (Array.isArray(addonIds) && addonIds.length > 0) {
    return Response.json(
      { success: false, error: "Add-ons require payment — please use standard checkout." },
      { status: 422 }
    );
  }

  const supabase = await createAdminClient();

  // ── Step 1: Server-side price + promo verification (THREAT-013) ──────────
  const { data: sessionPriceRow, error: sessionFetchError } = await supabase
    .from("class_sessions")
    .select("instructor_id, class_types(price)")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionFetchError) {
    console.error("[bookings/confirm-free] Session fetch failed:", sessionFetchError);
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

  const promoResult = await resolvePromoDiscount(supabase, promoCode.trim(), sessionId, dbPrice);

  if (!promoResult.valid) {
    return Response.json(
      { success: false, error: `Promo code invalid: ${promoResult.error}` },
      { status: 422 }
    );
  }

  // Guard: this route is only for truly free bookings — reject if final price > $0.
  // A tampered client trying to use a partial-discount code via this route is rejected here.
  if (promoResult.finalPrice > 0) {
    return Response.json(
      { success: false, error: "This promo code does not make the session free" },
      { status: 422 }
    );
  }

  // ── Step 2: Atomically reserve a spot via book_spot RPC (THREAT-006) ─────
  const { data: bookingId, error: rpcError } = await supabase.rpc("book_spot", {
    p_session_id: sessionId,
    p_customer_id: customerId,
    p_booking_source: "online",
    p_invoice_id: null,
  });

  if (rpcError || !bookingId) {
    const msg = rpcError?.message ?? "";
    if (msg.includes("already_booked")) {
      return Response.json(
        { success: false, error: "You're already booked into this class." },
        { status: 409 }
      );
    }
    if (msg.includes("session_full")) {
      return Response.json(
        { success: false, error: "This class just filled up." },
        { status: 409 }
      );
    }
    if (msg.includes("session_unavailable")) {
      return Response.json(
        { success: false, error: "Class is no longer available." },
        { status: 410 }
      );
    }
    if (msg.includes("session_not_found")) {
      return Response.json({ success: false, error: "Session not found." }, { status: 404 });
    }
    console.error("[bookings/confirm-free] book_spot failed:", rpcError);
    return Response.json({ success: false, error: "Failed to create booking." }, { status: 500 });
  }

  // Best-effort: notify the instructor if this booking pushed a BLS/ACLS
  // class to the assistant-required threshold (9 paid students).
  const assistantBaseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
  await maybeSendAssistantReminder(supabase, sessionId, assistantBaseUrl).catch((err: unknown) => {
    console.error("[bookings/confirm-free] Assistant reminder check failed (non-fatal):", err);
  });

  // ── Step 3: Create $0 payment record ─────────────────────────────────────
  const routingNote = `Free booking via promo code ${promoResult.code} (${dbPrice.toFixed(2)} discount)`;

  const { error: paymentInsertError } = await supabase.from("payments").insert({
    customer_id: customerId,
    booking_id: bookingId,
    amount: 0,
    status: "completed",
    payment_type: "promo",
    paypal_transaction_id: null,
    routing_note: routingNote,
  });

  if (paymentInsertError) {
    // Non-fatal: booking exists, just missing a $0 payment record — log for ops.
    console.error("[bookings/confirm-free] CRITICAL: $0 payment record insert failed", {
      bookingId,
      promoCode: promoResult.code,
      error: paymentInsertError,
    });
  }

  // ── Step 4: Send booking confirmation email (best-effort) ────────────────
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
        .select("first_name, email")
        .eq("id", customerId)
        .maybeSingle(),
    ]);

    const resolvedCustomerEmail =
      typeof customerEmail === "string" && customerEmail ? customerEmail : customerProfile?.email;

    if (!resolvedCustomerEmail) {
      console.error("[bookings/confirm-free] CRITICAL: no email on file — confirmation not sent", {
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
        amount: 0,
        // "SuperHeroCPR via promo code XYZ" lets the customer see how they paid $0
        paymentProcessor: `Promo code ${promoResult.code}`,
        transactionId: null,
        instructorName: instructorProfile
          ? `${instructorProfile.first_name} ${instructorProfile.last_name}`
          : null,
        instructorEmail: instructorProfile?.email ?? null,
        instructorPhone: instructorProfile?.phone ?? null,
      });

      const { error: emailError } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: resolvedCustomerEmail,
        subject,
        html,
      });

      if (emailError) {
        console.error("[bookings/confirm-free] Confirmation email failed:", {
          bookingId,
          error: emailError,
        });
      }
    }
  }

  return Response.json({ success: true, bookingId });
}
