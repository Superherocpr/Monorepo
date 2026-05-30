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
 * This route then sends a paid notification email to the instructor (best-effort).
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { invoicePaidEmail } from "@/lib/emails";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || !["instructor", "super_admin"].includes(profile.role)) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const adminClient = await createAdminClient();

  const { data: invoice } = await adminClient
    .from("invoices")
    .select(`
      id, instructor_id, invoice_number, student_count,
      recipient_name, status,
      profiles ( email, first_name, last_name )
    `)
    .eq("id", invoiceId)
    .single();

  if (!invoice) {
    return Response.json({ success: false, error: "Invoice not found" }, { status: 404 });
  }

  // Instructors may only mark their own invoices paid
  if (profile.role === "instructor" && invoice.instructor_id !== profile.id) {
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
    { p_invoice_id: invoiceId, p_actor_id: profile.id }
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
