/**
 * POST /api/invoices/resend
 * Called by: InvoiceDetailClient (Resend Invoice form)
 * Auth: Instructor (own invoice only) or super admin
 *
 * Resends the invoice email to the provided address.
 * If the email differs from the current recipient_email, updates the invoice record.
 * Logs the action with a note indicating whether the address was corrected.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { sendEmail } from "@/lib/send-email";
import { invoiceResendEmail } from "@/lib/emails";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (
    !isObject(body) ||
    typeof body.invoiceId !== "string" ||
    typeof body.newEmail !== "string"
  ) {
    return Response.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { invoiceId, newEmail } = body;

  // Basic email format validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return Response.json(
      { success: false, error: "Invalid email address" },
      { status: 400 }
    );
  }

  // Auth check
  const authResult = await requireApiRole(["instructor", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

  const { data: invoice } = await adminClient
    .from("invoices")
    .select(`
      id, instructor_id, invoice_number, invoice_type,
      recipient_name, recipient_email, company_name,
      student_count, total_amount, payment_platform,
      platform_invoice_id, status, notes,
      class_sessions (
        starts_at,
        class_types ( name ),
        locations ( name, city, state )
      )
    `)
    .eq("id", invoiceId)
    .single();

  if (!invoice) {
    return Response.json({ success: false, error: "Invoice not found" }, { status: 404 });
  }

  // Instructors may only resend their own invoices
  if (actor.effectiveRole === "instructor" && invoice.instructor_id !== actor.user.id) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  if (invoice.status !== "sent") {
    return Response.json(
      { success: false, error: "Only sent invoices can be resent" },
      { status: 400 }
    );
  }

  const originalEmail = invoice.recipient_email as string;
  const emailChanged = newEmail.toLowerCase() !== originalEmail.toLowerCase();

  // If email changed, update the invoice record
  if (emailChanged) {
    await adminClient
      .from("invoices")
      .update({ recipient_email: newEmail })
      .eq("id", invoiceId);
  }

  // Send invoice email via Resend. This is best-effort — if delivery fails,
  // we still log the resend action so there is a record of the attempt.
  // The instructor can retry if the email doesn't arrive.
  let emailSendError: string | null = null;
  {
    const session = invoice.class_sessions as unknown as {
      starts_at: string;
      class_types: { name: string } | null;
      locations: { name: string; city: string; state: string } | null;
    } | null;

    const { subject, html } = invoiceResendEmail({
      invoiceNumber: invoice.invoice_number,
      recipientName: invoice.recipient_name,
      className: session?.class_types?.name ?? "CPR Class",
      sessionDate: session?.starts_at ?? null,
      locationName: session?.locations?.name ?? "",
      locationCity: session?.locations?.city ?? "",
      locationState: session?.locations?.state ?? "",
      studentCount: invoice.student_count,
      totalAmount: typeof invoice.total_amount === "number" ? invoice.total_amount : null,
      notes: invoice.notes ?? null,
      paymentPlatform: invoice.payment_platform ?? null,
    });

    const result = await sendEmail({
      context: "invoices/resend",
      to: newEmail,
      subject,
      html,
    });

    // Captured so the reason lands in invoice_activity_log below — this route's
    // record of the attempt is what an admin reads when a customer says the
    // invoice never arrived.
    emailSendError = result.sent ? null : (result.error ?? result.reason);
  }

  // Log the action regardless of whether the email send succeeded.
  // If delivery failed, note it so admins can identify the issue.
  const baseLogNote = emailChanged
    ? `Resent to ${newEmail} (corrected from ${originalEmail})`
    : `Resent to ${newEmail}`;
  const logNote = emailSendError
    ? `${baseLogNote} (email delivery failed: ${emailSendError})`
    : baseLogNote;

  await adminClient.from("invoice_activity_log").insert({
    invoice_id: invoiceId,
    actor_id: actor.user.id,
    action: "resent",
    notes: logNote,
  });

  return Response.json({ success: true });
}
