/**
 * POST /api/invoices/mark-paid
 * Called by: InvoiceDetailClient (Mark as Paid confirmation)
 * Auth: Instructor (own invoice only) or super admin
 *
 * Marks an invoice as paid atomically via the mark_invoice_paid() Postgres RPC
 * (migration 0016). The RPC acquires a row-level lock on the invoice row so
 * concurrent requests cannot both pass the status='sent' check and double-insert
 * booking records (THREAT-038).
 *
 * The RPC handles:
 *   1. Locking the invoice row
 *   2. Verifying status = 'sent'
 *   3. Setting status = 'paid', paid_at = now()
 *   4. Inserting one booking row per student slot (booking_source = 'invoice')
 *   5. Logging the action in invoice_activity_log
 *
 * This route then records instructor earnings for PayPal Payouts and sends a
 * paid notification email to the instructor (best-effort).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { Resend } from "resend";
import { invoicePaidEmail } from "@/lib/emails";
import { recordInvoiceEarning } from "@/lib/instructor-earnings";
import { maybeTriggerImmediatePayout } from "@/lib/payout-trigger";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body) || typeof body.invoiceId !== "string") {
    return Response.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { invoiceId } = body;

  // Auth check
  const authResult = await requireApiRole(["instructor", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

  const { data: invoice } = await adminClient
    .from("invoices")
    .select(`
      id, instructor_id, invoice_number, student_count,
      recipient_name, status, total_amount,
      profiles ( email, first_name, last_name )
    `)
    .eq("id", invoiceId)
    .single();

  if (!invoice) {
    return Response.json({ success: false, error: "Invoice not found" }, { status: 404 });
  }

  // Instructors may only mark their own invoices paid
  if (actor.effectiveRole === "instructor" && invoice.instructor_id !== actor.user.id) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // Fast-fail before acquiring a DB lock — the RPC will also check this
  // atomically, but checking here avoids unnecessary lock contention.
  if (invoice.status !== "sent") {
    return Response.json(
      { success: false, error: "Invoice is not in sent status" },
      { status: 400 }
    );
  }

  // Atomic mark-paid via RPC (migration 0016_mark_invoice_paid_atomic.sql).
  // The RPC locks the invoice row, verifies status='sent', sets status='paid',
  // inserts booking rows, and logs the action — all in one transaction.
  const { data: rpcResult, error: rpcError } = await adminClient.rpc(
    "mark_invoice_paid",
    { p_invoice_id: invoiceId, p_actor_id: actor.user.id }
  );

  if (rpcError) {
    // invoice_not_found → 404; invoice_not_sent → 400 (already paid/cancelled)
    if (rpcError.message?.includes("invoice_not_found")) {
      return Response.json(
        { success: false, error: "Invoice not found" },
        { status: 404 }
      );
    }
    if (rpcError.message?.includes("invoice_not_sent")) {
      return Response.json(
        { success: false, error: "Invoice is not in sent status" },
        { status: 400 }
      );
    }
    console.error("[invoices/mark-paid] RPC error:", rpcError);
    return Response.json(
      { success: false, error: "Failed to mark invoice as paid. Please try again." },
      { status: 500 }
    );
  }

  const paidAt = (rpcResult as { paid_at?: string } | null)?.paid_at;

  await recordInvoiceEarning(adminClient, {
    instructorId: invoice.instructor_id,
    invoiceId: invoice.id,
    grossAmount: Number(invoice.total_amount),
    note: `Invoice ${invoice.invoice_number} marked paid`,
  }).catch((err: unknown) => {
    console.error("[invoices/mark-paid] CRITICAL: instructor earning insert failed", {
      invoiceId,
      invoiceNumber: invoice.invoice_number,
      error: err,
    });
  });

  // Fire a payout immediately if the system is configured for immediate trigger mode.
  // Non-blocking: the invoice response is not delayed by the payout call.
  await maybeTriggerImmediatePayout(adminClient);

  // Send paid notification email to the instructor
  const instructorProfile = invoice.profiles as unknown as {
    email: string;
    first_name: string;
    last_name: string;
  } | null;

  if (process.env.RESEND_API_KEY && instructorProfile?.email) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html } = invoicePaidEmail({
      firstName: instructorProfile.first_name,
      invoiceNumber: invoice.invoice_number,
      recipientName: invoice.recipient_name,
      studentCount: invoice.student_count as number,
    });
    // Non-fatal: the invoice is already marked paid and the bookings are
    // created — a failed notification email shouldn't surface as a 5xx to
    // the caller (Resend outages would otherwise reverse the mark-paid action).
    await resend.emails
      .send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: instructorProfile.email,
        subject,
        html,
      })
      .catch((err: unknown) => {
        console.error(
          "[invoices/mark-paid] Notification email failed (non-fatal):",
          err
        );
      });
  }

  return Response.json({ success: true, paidAt });
}
