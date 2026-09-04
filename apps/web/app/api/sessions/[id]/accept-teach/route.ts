/**
 * POST /api/sessions/[id]/accept-teach
 * Called by: session detail page "Accept to Teach" button
 * Auth: instructor, manager, super_admin
 *
 * Atomically assigns the calling staff member as instructor on a customer-requested
 * session that has no instructor yet (first-come-first-serve).
 *
 * Uses a conditional UPDATE (WHERE instructor_id IS NULL) to avoid races.
 * If another instructor already claimed the session, returns 409.
 *
 * On success:
 *   1. Updates class_sessions.instructor_id
 *   2. Updates class_requests.status = 'instructor_assigned' (via class_request_id)
 *   3. Emails the customer that their instructor is confirmed
 *   4. Emails all super_admin and manager profiles about the assignment
 *   5. Auto-creates and sends a group PayPal invoice to the customer for
 *      class price (per student) + travel fee, so payment collection starts
 *      immediately instead of waiting on a manual "Send Invoice" click. This
 *      is what puts the class through the same paid-invoice path that already
 *      records instructor earnings and triggers payouts.
 *
 * Invoice auto-creation and both emails are best-effort — a failure in any of
 * them does not roll back the instructor assignment, which is the operation
 * this route exists to make atomic. Failures are logged for admin follow-up.
 *
 * Returns { data: { ok: true } } on success, 409 on race-condition conflict.
 */

import { NextResponse } from "next/server";
import { sendEmail, isEmailConfigured } from "@/lib/send-email";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { instructorAcceptedAdminEmail, instructorConfirmedCustomerEmail } from "@/lib/emails";
import { createAndSendInvoice, type InvoiceLineItem } from "@/lib/invoice-actions";

/** Route handler params from the dynamic [id] segment. */
interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Assigns the calling instructor to a customer-requested session (atomic, first-come-first-serve).
 * Sends the customer and admin/manager notification emails, and auto-invoices
 * the customer, on successful assignment.
 */
export async function POST(_request: Request, { params }: Params): Promise<Response> {
  const auth = await requireApiRole(["instructor", "manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const { id: sessionId } = await params;
  const actor = auth.actor;

  const admin = await createAdminClient();

  // Fetch the session to verify it's a customer-requested session with no instructor
  const { data: session } = await admin
    .from("class_sessions")
    .select(`
      id, instructor_id, class_request_id, starts_at,
      class_types ( name, price ),
      locations ( name, city, state )
    `)
    .eq("id", sessionId)
    .single();

  if (!session) {
    return NextResponse.json(
      { data: null, error: "Session not found" },
      { status: 404 }
    );
  }

  if (!session.class_request_id) {
    return NextResponse.json(
      { data: null, error: "This session is not a customer-requested class" },
      { status: 400 }
    );
  }

  if (session.instructor_id !== null) {
    return NextResponse.json(
      { data: null, error: "This class has already been claimed by another instructor" },
      { status: 409 }
    );
  }

  // ── Atomic conditional update — only succeeds if instructor_id IS NULL ─────
  // Supabase does not expose affected-row count on UPDATE, so we use .select()
  // to see whether the row was actually modified. If instructor_id was set by a
  // concurrent request between our check and this write, the WHERE clause will
  // match zero rows and the return will be null.
  const { data: updatedSession, error: updateError } = await admin
    .from("class_sessions")
    .update({ instructor_id: actor.user.id })
    .eq("id", sessionId)
    .is("instructor_id", null)   // the atomic guard: only touch un-claimed rows
    .select("id, instructor_id")
    .single();

  if (updateError || !updatedSession || updatedSession.instructor_id !== actor.user.id) {
    // Another instructor got there first (race) or some other DB error
    console.warn(
      "[accept-teach] Concurrent claim detected or update failed for session:",
      sessionId,
      updateError
    );
    return NextResponse.json(
      { data: null, error: "This class was just claimed by another instructor" },
      { status: 409 }
    );
  }

  // ── Update class_requests status to instructor_assigned ───────────────────
  const { data: classRequest, error: requestUpdateError } = await admin
    .from("class_requests")
    .update({ status: "instructor_assigned" })
    .eq("id", session.class_request_id)
    .select("id, customer_id, group_size, travel_fee, venue_name")
    .single();

  if (requestUpdateError || !classRequest) {
    // Non-fatal — session is assigned; log and continue
    console.error("[accept-teach] Failed to update class_request status:", requestUpdateError);
  }

  const classType = session.class_types as unknown as { name: string; price: number | string } | null;
  const location = session.locations as unknown as { name: string; city: string; state: string } | null;
  const instructorFullName = `${actor.profile.first_name} ${actor.profile.last_name}`;

  // Invoicing is bundled into this block, so an unconfigured mailer skips both.
  if (!isEmailConfigured()) {
    console.warn("[accept-teach] Resend not configured — skipping emails and invoicing");
    return NextResponse.json({ data: { ok: true } });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";

  // ── Notify the customer their instructor is confirmed (best-effort) ────────
  if (classRequest && classType && location) {
    const { data: customerProfile } = await admin
      .from("profiles")
      .select("email, first_name, last_name")
      .eq("id", classRequest.customer_id)
      .single();

    if (customerProfile?.email) {
      const confirmedEmail = instructorConfirmedCustomerEmail({
        firstName: customerProfile.first_name,
        instructorName: instructorFullName,
        className: classType.name,
        sessionDate: session.starts_at,
        venueName: location.name,
        venueCity: location.city,
        venueState: location.state,
      });
      await sendEmail({
        context: "accept-teach:customer",
        to: customerProfile.email,
        subject: confirmedEmail.subject,
        html: confirmedEmail.html,
        idempotencyKey: `accept-teach-customer-${sessionId}`,
      });
    }

    // ── Auto-create and send the invoice (best-effort) ───────────────────────
    // Runs after the customer confirmation email so the customer always hears
    // "instructor confirmed" even if invoicing fails and needs manual follow-up.
    if (customerProfile?.email) {
      try {
        const rawPrice = classType.price;
        const classPrice = typeof rawPrice === "number" ? rawPrice : parseFloat(String(rawPrice ?? "0"));
        const travelFee = Number(classRequest.travel_fee) || 0;
        const studentCount = classRequest.group_size;

        if (!Number.isFinite(classPrice) || studentCount < 1) {
          throw new Error(`Invalid pricing/group size: price=${rawPrice}, groupSize=${studentCount}`);
        }

        const extraLineItems: InvoiceLineItem[] =
          travelFee > 0 ? [{ name: "Travel Fee", quantity: 1, unitAmount: travelFee }] : [];
        const totalAmount = classPrice * studentCount + travelFee;
        const recipientName =
          [customerProfile.first_name, customerProfile.last_name].filter(Boolean).join(" ") || "Customer";

        const invoiceResult = await createAndSendInvoice(admin, {
          sessionId,
          instructorId: actor.user.id,
          instructorName: instructorFullName,
          invoiceType: "group",
          recipientName,
          recipientEmail: customerProfile.email,
          companyName: classRequest.venue_name,
          studentCount,
          amountPerStudent: classPrice,
          totalAmount,
          // total_amount includes the travel fee line item, so it's not a
          // plain amountPerStudent * studentCount multiplication.
          customPrice: true,
          notes: null,
          className: classType.name,
          classDate: session.starts_at,
          locationName: location.name,
          locationCity: location.city,
          locationState: location.state,
          actorId: actor.user.id,
          extraLineItems,
        });

        if (!invoiceResult.success) {
          console.error("[accept-teach] Auto-invoice creation failed:", invoiceResult.error);
        }
      } catch (err) {
        console.error("[accept-teach] Auto-invoice creation threw:", err);
      }
    }
  }

  // ── Send admin notification emails (best-effort) ──────────────────────────
  const { data: adminProfiles } = await admin
    .from("profiles")
    .select("email")
    .in("role", ["super_admin", "manager"])
    .eq("deactivated", false);

  const adminEmails = (adminProfiles ?? []).map((p) => p.email).filter(Boolean);

  if (adminEmails.length > 0 && classType && location) {
    const notifyEmail = instructorAcceptedAdminEmail({
      instructorName: instructorFullName,
      className: classType.name,
      sessionDate: session.starts_at,
      venueName: location.name,
      venueCity: location.city,
      venueState: location.state,
      sessionId,
      baseUrl,
    });

    await sendEmail({
      context: "accept-teach:admin",
      to: adminEmails,
      subject: notifyEmail.subject,
      html: notifyEmail.html,
      idempotencyKey: `accept-teach-admin-${sessionId}`,
    });
  }

  return NextResponse.json({ data: { ok: true } });
}
