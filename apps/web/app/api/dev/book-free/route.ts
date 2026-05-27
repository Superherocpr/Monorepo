/**
 * POST /api/dev/book-free
 * Called by: book/payment page — "Skip Payment" dev testing button only
 * Auth: None required — this route is entirely disabled outside development
 *
 * DEV ONLY. This route is a hard 404 in any environment other than
 * process.env.NODE_ENV === 'development'. It exists to speed up testing the
 * end-to-end booking → rollcall → grading → Enrollware bookmarklet flow
 * without needing a real PayPal transaction each time.
 *
 * Steps:
 * 1. Guard: returns 404 unless NODE_ENV === 'development'.
 * 2. Validates required fields.
 * 3. Auto-approves the session if still pending_approval (dev convenience).
 * 4. Atomically reserves a spot via the book_spot RPC (same as the real flow).
 * 5. Creates a payment record typed as 'cash' with amount $0 and a clear
 *    dev-bypass note so it's easy to identify in the DB.
 * 6. Sends the standard booking confirmation email (best-effort).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { bookingConfirmationEmail } from "@/lib/emails";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  // ── Guard: dev only ──────────────────────────────────────────────────────
  // Return a generic 404 rather than 403 so production endpoints don't reveal
  // that this route exists at all.
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const {
    sessionId,
    customerId,
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

  if (typeof sessionId !== "string" || typeof customerId !== "string") {
    return Response.json({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  const supabase = await createAdminClient();

  // ── Step 1: Auto-approve the session if still pending ───────────────────
  // book_spot rejects sessions where approval_status <> 'approved'. In the
  // real flow a manager does this manually, but for dev testing we approve
  // automatically so the full flow can be exercised without the extra step.
  const { error: approveError } = await supabase
    .from("class_sessions")
    .update({ approval_status: "approved" })
    .eq("id", sessionId)
    .eq("approval_status", "pending_approval"); // no-op if already approved

  if (approveError) {
    console.warn("[dev/book-free] Could not auto-approve session:", approveError);
    // Non-fatal — book_spot will surface the real error if approval is still blocking.
  }

  // ── Step 2: Atomically reserve a spot (same RPC as the real flow) ────────
  const { data: bookingId, error: rpcError } = await supabase.rpc("book_spot", {
    p_session_id: sessionId,
    p_customer_id: customerId,
    p_booking_source: "online",
    p_invoice_id: null,
  });

  if (rpcError || !bookingId) {
    const msg = rpcError?.message ?? "";
    if (msg.includes("session_full")) {
      return Response.json({ success: false, error: "Class is full." }, { status: 409 });
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
    // Surface the raw error in dev so it shows in the UI for easier diagnosis.
    const rawMsg = rpcError?.message ?? rpcError?.details ?? "Unknown RPC error";
    console.error("[dev/book-free] book_spot failed:", rawMsg, rpcError);
    return Response.json(
      { success: false, error: `book_spot failed: ${rawMsg}` },
      { status: 500 }
    );
  }

  // ── Step 3: Create a $0 payment record clearly marked as a dev bypass ────
  // Uses payment_type 'cash' (the closest valid enum value for non-PayPal
  // payments) with amount 0 and an explicit routing_note so dev records are
  // easy to spot and clean up in the staging DB.
  const { error: paymentInsertError } = await supabase.from("payments").insert({
    customer_id: customerId,
    booking_id: bookingId,
    amount: 0,
    status: "completed",
    payment_type: "cash",
    paypal_transaction_id: null,
    routing_note: "DEV BYPASS — no payment captured (development environment)",
  });

  if (paymentInsertError) {
    console.error("[dev/book-free] Payment insert failed:", paymentInsertError);
    // Don't block the booking — the spot was reserved; the missing payment
    // record is a non-critical issue in a dev-only flow.
  }

  // ── Step 4: Send confirmation email (best-effort, same as real flow) ─────
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html } = bookingConfirmationEmail({
      firstName: typeof customerFirstName === "string" ? customerFirstName : "there",
      className: typeof className === "string" ? className : "your class",
      startsAt: typeof startsAt === "string" ? startsAt : "",
      locationName: typeof locationName === "string" ? locationName : "",
      locationAddress: typeof locationAddress === "string" ? locationAddress : "",
      locationCity: typeof locationCity === "string" ? locationCity : "",
      locationState: typeof locationState === "string" ? locationState : "",
      locationZip: typeof locationZip === "string" ? locationZip : "",
      amount: 0,
      paymentProcessor: "Dev bypass (no charge)",
    });

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "",
      to: typeof customerEmail === "string" ? customerEmail : "",
      subject,
      html,
    });
  } catch (emailErr) {
    // Email failure is non-fatal — log and continue so the test flow isn't blocked.
    console.error("[dev/book-free] Confirmation email failed:", emailErr);
  }

  return Response.json({ success: true, bookingId });
}
