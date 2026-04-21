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

    const session = invoice.class_sessions as {
      starts_at: string;
      class_types: { name: string } | null;
      locations: { name: string; city: string; state: string } | null;
    } | null;

    const className = session?.class_types?.name ?? "CPR Class";
    const sessionDate = session?.starts_at
      ? new Date(session.starts_at).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : "See your instructor for details";
    const locationName = session?.locations?.name ?? "";
    const locationCity = session?.locations?.city ?? "";
    const locationState = session?.locations?.state ?? "";

    const amount = typeof invoice.total_amount === "number"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(invoice.total_amount)
      : "$0.00";

    await resend.emails.send({
      from: "Superhero CPR <noreply@superherocpr.com>",
      to: newEmail,
      subject: `Invoice ${invoice.invoice_number} from Superhero CPR`,
      html: `
        <h1>Invoice ${invoice.invoice_number}</h1>
        <p>Hello ${invoice.recipient_name},</p>
        <p>Please find your invoice for the upcoming CPR class below.</p>
        <table style="border-collapse:collapse;width:100%;max-width:500px">
          <tr><td style="padding:8px;color:#555">Class</td><td style="padding:8px;font-weight:bold">${className}</td></tr>
          <tr><td style="padding:8px;color:#555">Date</td><td style="padding:8px">${sessionDate}</td></tr>
          <tr><td style="padding:8px;color:#555">Location</td><td style="padding:8px">${locationName}, ${locationCity}, ${locationState}</td></tr>
          <tr><td style="padding:8px;color:#555">Students</td><td style="padding:8px">${invoice.student_count}</td></tr>
          <tr><td style="padding:8px;color:#555;font-weight:bold">Total Due</td><td style="padding:8px;font-weight:bold;font-size:18px">${amount}</td></tr>
        </table>
        ${invoice.notes ? `<p style="margin-top:16px;color:#555">Note: ${invoice.notes}</p>` : ""}
        <p style="margin-top:24px">Payment platform: ${invoice.payment_platform}</p>
        <p>— Superhero CPR</p>
      `,
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
