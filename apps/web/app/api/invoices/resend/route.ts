/**
 * POST /api/invoices/resend
 * Called by: InvoiceDetailClient (Resend Invoice form)
 * Auth: Instructor (own invoice only) or super admin
 *
 * Resends the invoice email to the provided address.
 * If the email differs from the current recipient_email, updates the invoice record.
 * Logs the action with a note indicating whether the address was corrected.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";
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
  if (profile.role === "instructor" && invoice.instructor_id !== profile.id) {
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

  // Send invoice email via Resend
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);

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

    await resend.emails.send({
      from: "SuperHeroCPR <noreply@superherocpr.com>",
      to: newEmail,
      subject,
      html,
    });
  }

  // Log the action
  const logNote = emailChanged
    ? `Resent to ${newEmail} (corrected from ${originalEmail})`
    : `Resent to ${newEmail}`;

  await adminClient.from("invoice_activity_log").insert({
    invoice_id: invoiceId,
    actor_id: profile.id,
    action: "resent",
    notes: logNote,
  });

  return Response.json({ success: true });
}
