/**
 * POST /api/invoices/edit
 * Called by: InvoiceDetailClient (Edit Invoice form)
 * Auth: Instructor or manager (own invoice only), or super admin (any invoice)
 *
 * Edits a sent, unpaid invoice: student count, price per student, travel fee,
 * and the recipient's name and email. The class cannot be changed.
 *
 * Flat team invoices (stored with 0 students) have no student count; their
 * editable price is the whole flat price, and the new price is written back to
 * the linked team booking so the two never disagree.
 *
 * Order matters. The total is recomputed on the server (the client's numbers are
 * never trusted), then PayPal is updated FIRST and our DB only if PayPal accepts,
 * the same rule cancel follows, so the customer's invoice and ours cannot
 * disagree. PayPal emails the customer its update; we then send our own email,
 * worded as an update so it is not read as a second bill.
 *
 * Side effects: PayPal invoice update, invoices row update, team_bookings.total_price
 * update (flat team invoices), activity log insert, one Resend email.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { sendEmail } from "@/lib/send-email";
import { getPayPalConnectBase } from "@/lib/paypal";
import { hasClassEnded } from "@/lib/business-time";
import { invoiceEmail } from "@/lib/emails";
import { TEACHING_ROLES, canUseInstructorToolsOn } from "@/lib/auth/view-as-constants";
import {
  rosterTemplateAttachment,
  updateBusinessPayPalInvoice,
} from "@/lib/invoice-actions";
import {
  buildEditedLineItems,
  computeInvoiceTotal,
  rebuildFlatLineItems,
  validateInvoiceEdit,
} from "@/lib/invoice-edit";

/** Type guard: ensures a value is a non-null plain object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Takes the first row of a Supabase FK join, which may arrive as an array or an object. */
function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

/** Formats dollars for activity-log notes. */
function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Validates and applies an edit to a sent invoice.
 * @param request - JSON body: invoiceId, recipientName, recipientEmail,
 *                  studentCount, amountPerStudent, travelFee.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (
    !isObject(body) ||
    typeof body.invoiceId !== "string" ||
    typeof body.recipientName !== "string" ||
    typeof body.recipientEmail !== "string"
  ) {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const { invoiceId } = body;
  const recipientName = body.recipientName.trim();
  const recipientEmail = body.recipientEmail.trim();

  if (!recipientName) {
    return Response.json({ success: false, error: "Recipient name is required." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return Response.json({ success: false, error: "Invalid recipient email address" }, { status: 400 });
  }

  const authResult = await requireApiRole(TEACHING_ROLES);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

  const { data: invoice } = await adminClient
    .from("invoices")
    .select(`
      id, instructor_id, invoice_number, invoice_type, recipient_name,
      recipient_email, company_name, student_count, amount_per_student,
      total_amount, travel_fee, platform_invoice_id, payment_platform, status, notes,
      class_session_id,
      class_sessions (
        id, starts_at, ends_at, max_capacity,
        class_types ( name, price ),
        locations ( name, city, state ),
        bookings ( id, cancelled ),
        invoices ( id, student_count, status )
      ),
      profiles ( first_name, last_name )
    `)
    .eq("id", invoiceId)
    .single();

  if (!invoice) {
    return Response.json({ success: false, error: "Invoice not found" }, { status: 404 });
  }

  if (!canUseInstructorToolsOn(actor.effectiveRole, actor.user.id, invoice.instructor_id)) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  if (invoice.status !== "sent") {
    return Response.json(
      { success: false, error: "Only sent invoices can be edited." },
      { status: 400 }
    );
  }

  if (!invoice.platform_invoice_id || invoice.payment_platform !== "paypal") {
    return Response.json(
      { success: false, error: "This invoice has no PayPal invoice to update." },
      { status: 400 }
    );
  }

  const oldCount = Number(invoice.student_count);
  // Team invoices billed as one flat total are stored with 0 students on purpose
  // (so they never reserve seats) and amount_per_student holds the flat price.
  const isFlat = oldCount === 0;

  // Validated here, not earlier, because the rules differ for a flat invoice.
  const numbersError = validateInvoiceEdit({
    studentCount: isFlat ? 0 : body.studentCount,
    amountPerStudent: body.amountPerStudent,
    travelFee: body.travelFee,
    flat: isFlat,
  });
  if (numbersError) {
    return Response.json({ success: false, error: numbersError }, { status: 400 });
  }
  const studentCount = isFlat ? 0 : (body.studentCount as number);
  const amountPerStudent = Math.round((body.amountPerStudent as number) * 100) / 100;
  const travelFee = Math.round((body.travelFee as number) * 100) / 100;

  const session = firstRow<{
    starts_at: string;
    ends_at: string | null;
    max_capacity: number;
    class_types: unknown;
    locations: unknown;
    bookings: unknown;
    invoices: unknown;
  }>(invoice.class_sessions);
  if (!session) {
    return Response.json({ success: false, error: "Class session not found" }, { status: 404 });
  }
  const classType = firstRow<{ name?: string | null; price?: number | string | null }>(session.class_types);
  const location = firstRow<{ name?: string | null; city?: string | null; state?: string | null }>(
    session.locations
  );

  // Raising the count must not oversell the class. Same arithmetic as invoice
  // creation, except this invoice's own seats are left out of the "taken" total.
  // A class that has already ended has no seats left to protect.
  if (!isFlat && studentCount > oldCount && !hasClassEnded(session.starts_at, session.ends_at)) {
    const bookings = Array.isArray(session.bookings) ? session.bookings : [];
    const invoices = Array.isArray(session.invoices) ? session.invoices : [];
    const activeBookings = bookings.filter((b: { cancelled: boolean }) => !b.cancelled).length;
    const otherInvoiceSeats = invoices
      .filter((i: { id: string; status: string }) => i.id !== invoice.id && i.status !== "cancelled")
      .reduce((sum: number, i: { student_count: number }) => sum + i.student_count, 0);
    const spotsForThisInvoice = session.max_capacity - activeBookings - otherInvoiceSeats;
    if (studentCount > spotsForThisInvoice) {
      return Response.json(
        {
          success: false,
          error: `Only ${Math.max(spotsForThisInvoice, 0)} spot${spotsForThisInvoice === 1 ? "" : "s"} available for this invoice. Please reduce the student count.`,
        },
        { status: 409 }
      );
    }
  }

  const oldPrice = Number(invoice.amount_per_student);
  const oldTotal = Number(invoice.total_amount);
  const oldTravel = Number(invoice.travel_fee);
  // Untouched numbers keep the stored total. A custom-total invoice's per-student
  // price is rounded to cents, so recomputing would nudge the total by a cent on
  // an edit that only fixed a name.
  const numbersUnchanged =
    studentCount === oldCount && amountPerStudent === oldPrice && travelFee === oldTravel;
  const newTotal = numbersUnchanged
    ? oldTotal
    : computeInvoiceTotal(isFlat ? 1 : studentCount, amountPerStudent, travelFee);

  const changes: string[] = [];
  if (recipientName !== invoice.recipient_name) changes.push(`name to ${recipientName}`);
  if (recipientEmail.toLowerCase() !== String(invoice.recipient_email).toLowerCase()) {
    changes.push(`email to ${recipientEmail} (was ${invoice.recipient_email})`);
  }
  if (!isFlat && studentCount !== oldCount) changes.push(`students ${oldCount} to ${studentCount}`);
  if (amountPerStudent !== oldPrice) changes.push(`${isFlat ? "flat price" : "price"} ${money(oldPrice)} to ${money(amountPerStudent)}`);
  if (travelFee !== oldTravel) changes.push(`travel fee ${money(oldTravel)} to ${money(travelFee)}`);
  if (changes.length === 0) {
    return Response.json({ success: false, error: "Nothing was changed." }, { status: 400 });
  }

  const className = classType?.name ?? "CPR Class";

  // PayPal first: if it refuses, our records stay exactly as the customer sees them.
  const paypalError = await updateBusinessPayPalInvoice({
    platformInvoiceId: invoice.platform_invoice_id,
    recipientEmail,
    items: isFlat
      ? (current) => rebuildFlatLineItems(current, amountPerStudent, travelFee)
      : buildEditedLineItems(className, studentCount, amountPerStudent, travelFee),
  });
  if (paypalError) {
    return Response.json({ success: false, error: paypalError }, { status: 502 });
  }

  const rawClassPrice = Number(classType?.price);
  const matchesCatalogPrice = Number.isFinite(rawClassPrice) && amountPerStudent === rawClassPrice;

  // The status guard keeps a payment that landed while PayPal was being updated
  // from being overwritten.
  const { data: updated, error: updateError } = await adminClient
    .from("invoices")
    .update({
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      // A flat team invoice keeps student_count 0 and custom_price true.
      ...(isFlat
        ? {}
        : { student_count: studentCount, custom_price: !matchesCatalogPrice || travelFee > 0 }),
      amount_per_student: amountPerStudent,
      total_amount: newTotal,
      travel_fee: travelFee,
    })
    .eq("id", invoice.id)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    console.error("[invoices/edit] DB update failed after PayPal update:", updateError);
    return Response.json(
      {
        success: false,
        error:
          "PayPal was updated but our record could not be saved. Open the invoice again to check it, then repeat the edit.",
      },
      { status: 500 }
    );
  }

  // The invoice is the source of truth for what was billed (see ensureTeamInvoice),
  // so the team booking's recorded total follows it. Best-effort: the edit is
  // already live in PayPal and on the invoice.
  if (isFlat && amountPerStudent !== oldPrice) {
    const { error: syncError } = await adminClient
      .from("team_bookings")
      .update({ total_price: amountPerStudent })
      .eq("invoice_id", invoice.id);
    if (syncError) {
      console.error("[invoices/edit] team_bookings.total_price sync failed:", syncError);
    }
  }

  const instructor = firstRow<{ first_name: string | null; last_name: string | null }>(invoice.profiles);
  const instructorName =
    [instructor?.first_name, instructor?.last_name].filter(Boolean).join(" ") || null;
  const invoiceType = invoice.invoice_type === "group" ? "group" : "individual";

  // Best-effort, like resend: the edit is already live, so a mail failure is
  // recorded in the log for staff rather than undoing it.
  const { subject, html } = invoiceEmail({
    invoiceNumber: invoice.invoice_number,
    recipientName,
    invoiceType,
    companyName: invoice.company_name,
    studentCount,
    totalAmount: newTotal,
    className,
    classDate: session.starts_at,
    locationName: location?.name ?? "",
    locationCity: location?.city ?? "",
    locationState: location?.state ?? "",
    instructorName,
    notes: invoice.notes,
    // The PayPal invoice id is unchanged by an edit, so the original link still works.
    paymentLink: `${getPayPalConnectBase()}/invoice/p/#${invoice.platform_invoice_id}`,
    isUpdate: true,
  });
  const emailResult = await sendEmail({
    context: "invoices/edit",
    to: recipientEmail,
    subject,
    html,
    ...(invoiceType === "group" && { attachments: [rosterTemplateAttachment()] }),
  });
  const emailFailure = emailResult.sent ? null : (emailResult.error ?? emailResult.reason);

  await adminClient.from("invoice_activity_log").insert({
    invoice_id: invoice.id,
    actor_id: actor.user.id,
    action: "edited",
    notes: `Changed ${changes.join(", ")}. New total ${money(newTotal)}.${
      emailFailure ? ` (email delivery failed: ${emailFailure})` : ""
    }`,
  });

  return Response.json({
    success: true,
    recipientName,
    recipientEmail,
    studentCount,
    amountPerStudent,
    totalAmount: newTotal,
  });
}
