/**
 * POST /api/invoices/mark-paid
 * Called by: InvoiceDetailClient (Mark as Paid confirmation)
 * Auth: Instructor (own invoice only) or super admin
 *
 * Marks an invoice as paid:
 * 1. Sets invoice status = 'paid', paid_at = now()
 * 2. Creates booking records for each student slot (booking_source = 'invoice')
 * 3. Logs the action in invoice_activity_log
 * 4. Sends a paid notification email to the instructor
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Resend } from "resend";

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
      class_sessions ( id ),
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

  if (invoice.status !== "sent") {
    return Response.json(
      { success: false, error: "Invoice is not in sent status" },
      { status: 400 }
    );
  }

  const sessionId = (invoice.class_sessions as unknown as { id: string } | null)?.id;

  if (!sessionId) {
    return Response.json(
      { success: false, error: "Invoice has no linked class session" },
      { status: 400 }
    );
  }

  const paidAt = new Date().toISOString();

  // Mark the invoice as paid
  await adminClient
    .from("invoices")
    .update({ status: "paid", paid_at: paidAt })
    .eq("id", invoiceId);

  // Create one booking record per student slot — booking_source = 'invoice'
  // These bookings represent the spots held by the invoice recipient's students.
  // customer_id is the instructor who owns the invoice (acting as the booking agent).
  const bookingRows = Array.from({ length: invoice.student_count as number }).map(() => ({
    session_id: sessionId,
    customer_id: invoice.instructor_id as string,
    invoice_id: invoiceId,
    booking_source: "invoice",
    created_by: profile.id,
  }));

  await adminClient.from("bookings").insert(bookingRows);

  // Log the action
  await adminClient.from("invoice_activity_log").insert({
    invoice_id: invoiceId,
    actor_id: profile.id,
    action: "marked_paid",
  });

  // Send paid notification email to the instructor
  const instructorProfile = invoice.profiles as unknown as {
    email: string;
    first_name: string;
    last_name: string;
  } | null;

  if (process.env.RESEND_API_KEY && instructorProfile?.email) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "SuperHeroCPR <noreply@superherocpr.com>",
      to: instructorProfile.email,
      subject: `Invoice ${invoice.invoice_number} marked as paid`,
      html: `
        <p>Hi ${instructorProfile.first_name},</p>
        <p>Invoice <strong>${invoice.invoice_number}</strong> for ${invoice.recipient_name} has been marked as paid.</p>
        <p>${invoice.student_count} student spot${(invoice.student_count as number) !== 1 ? "s" : ""} have been reserved for the class.</p>
        <p>— SuperHeroCPR</p>
      `,
    });
  }

  return Response.json({ success: true });
}
