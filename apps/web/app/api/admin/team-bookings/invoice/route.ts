/**
 * POST /api/admin/team-bookings/invoice
 * Called by: TeamBookingsClient (/admin/team-bookings) — the "Raise invoice" button
 * Auth: manager or super_admin session
 *
 * Raises the flat company invoice for a team booking that does not have one,
 * for the case where invoice creation failed at booking time. Delegates to
 * ensureTeamInvoice(), which re-reads the booking first and refuses to raise a
 * second invoice, so a double-click or a race with the nightly sweep cannot
 * bill the company twice.
 *
 * Instructors are deliberately excluded even though they can create team
 * bookings: re-raising an invoice sends live money email to a company contact,
 * which is a manager decision.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { ensureTeamInvoice } from "@/lib/team-bookings";

/** Staff roles permitted to raise a team invoice by hand. */
const ALLOWED_ROLES = ["manager", "super_admin"] as const;

/**
 * Handles the manual invoice-retry request for one team booking.
 * Side effects: on success, a PayPal invoice creation + send, invoices and
 * invoice_activity_log inserts, a Resend email to the company contact, and an
 * UPDATE on team_bookings.invoice_id.
 * @param request - JSON body carrying `team_booking_id`.
 * @returns JSON describing what happened, or an error and status code.
 */
export async function POST(request: Request): Promise<Response> {
  const authResult = await requireApiRole([...ALLOWED_ROLES]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const teamBookingId =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).team_booking_id
      : null;

  if (typeof teamBookingId !== "string" || !teamBookingId.trim()) {
    return NextResponse.json({ error: "team_booking_id is required." }, { status: 400 });
  }

  const adminClient = await createAdminClient();
  const result = await ensureTeamInvoice(adminClient, {
    teamBookingId: teamBookingId.trim(),
    actorId: actor.user.id,
  });

  switch (result.status) {
    case "created":
      return NextResponse.json({
        success: true,
        status: result.status,
        invoiceId: result.invoiceId,
        invoiceNumber: result.invoiceNumber,
        message: `Invoice ${result.invoiceNumber} was raised and emailed to the contact.`,
      });

    case "created_unlinked":
      // The money side succeeded; only the link failed. Reported as an error so
      // the operator acts, but never as a prompt to retry — that would double-bill.
      return NextResponse.json(
        {
          success: false,
          status: result.status,
          invoiceId: result.invoiceId,
          invoiceNumber: result.invoiceNumber,
          error: `Invoice ${result.invoiceNumber} was sent to the contact but could not be attached to this booking. Do not retry — contact support to link it by hand.`,
        },
        { status: 500 }
      );

    case "already_linked":
      return NextResponse.json({
        success: true,
        status: result.status,
        invoiceId: result.invoiceId,
        message: "This booking already has an invoice.",
      });

    case "not_applicable":
      return NextResponse.json(
        { success: false, status: result.status, error: result.reason },
        { status: 400 }
      );

    case "failed":
      return NextResponse.json(
        { success: false, status: result.status, error: result.error },
        { status: 502 }
      );
  }
}
