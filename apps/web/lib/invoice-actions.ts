/**
 * Shared invoice creation and mark-paid logic.
 *
 * Extracted so that both a human-triggered action (CreateInvoiceClient →
 * POST /api/invoices/create, InvoiceDetailClient → POST /api/invoices/mark-paid)
 * and a system-triggered action (accept-teach auto-invoicing, the PayPal
 * paid-invoice webhook) go through the exact same PayPal calls, DB writes,
 * earnings recording, and customer/instructor emails — so the two paths can
 * never drift out of sync.
 *
 * Route files remain responsible for auth, request validation, and mapping
 * results to HTTP responses. This file has no knowledge of Request/Response.
 */

import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  invoiceEmail,
  invoicePaidEmail,
  invoicePaymentConfirmedCustomerEmail,
} from "@/lib/emails";
import {
  getPayPalAccessToken,
  getPayPalApiBase,
  getPayPalConnectBase,
} from "@/lib/paypal";
import { recordInvoiceEarning } from "@/lib/instructor-earnings";
import { maybeTriggerImmediatePayout } from "@/lib/payout-trigger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, "public", any>;

// ---------------------------------------------------------------------------
// PayPal business invoice creation
// ---------------------------------------------------------------------------

/** A single PayPal invoice line item — either the per-student class fee or an add-on like travel. */
export interface InvoiceLineItem {
  name: string;
  quantity: number;
  /** Unit price in dollars. */
  unitAmount: number;
}

/** Result from attempting to create an invoice on PayPal. */
interface PlatformResult {
  platformInvoiceId: string | null;
  paymentLink: string | null;
}

/** Parameters needed to create an invoice on PayPal. */
interface PlatformCreateParams {
  recipientEmail: string;
  invoiceNumber: string;
  items: InvoiceLineItem[];
}

/**
 * Creates and sends a PayPal invoice from the business PayPal account.
 * Side effects: creates a PayPal invoice and sends it to the recipient.
 * @param params - Recipient, invoice number, and line items for the PayPal payload.
 * @returns PayPal invoice id and hosted payment link, or null fields on failure.
 */
export async function createBusinessPayPalInvoice(
  params: PlatformCreateParams
): Promise<PlatformResult> {
  const accessToken = await getPayPalAccessToken();
  const apiBase = getPayPalApiBase();
  const connectBase = getPayPalConnectBase();

  try {
    const createRes = await fetch(`${apiBase}/v2/invoicing/invoices`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        detail: {
          invoice_date: new Date().toISOString().split("T")[0],
          currency_code: "USD",
          note: params.invoiceNumber,
        },
        primary_recipients: [
          { billing_info: { email_address: params.recipientEmail } },
        ],
        items: params.items.map((item) => ({
          name: item.name,
          quantity: String(item.quantity),
          unit_amount: {
            currency_code: "USD",
            value: item.unitAmount.toFixed(2),
          },
        })),
      }),
      cache: "no-store",
    });

    if (!createRes.ok) {
      const errorText = await createRes.text().catch(() => "");
      console.error("[invoice-actions] PayPal invoice create failed:", errorText);
      return { platformInvoiceId: null, paymentLink: null };
    }

    const createData = (await createRes.json()) as { id?: string };
    const platformInvoiceId = createData.id ?? null;
    if (!platformInvoiceId) return { platformInvoiceId: null, paymentLink: null };

    const sendRes = await fetch(
      `${apiBase}/v2/invoicing/invoices/${platformInvoiceId}/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        cache: "no-store",
      }
    );

    if (!sendRes.ok) {
      const errorText = await sendRes.text().catch(() => "");
      console.error("[invoice-actions] PayPal invoice send failed:", errorText);
      return { platformInvoiceId: null, paymentLink: null };
    }

    return {
      platformInvoiceId,
      paymentLink: `${connectBase}/invoice/p/#${platformInvoiceId}`,
    };
  } catch (err) {
    console.error("[invoice-actions] PayPal invoice request failed:", err);
    return { platformInvoiceId: null, paymentLink: null };
  }
}

/**
 * Inserts the invoice row, retrying on invoice_number UNIQUE-constraint conflicts.
 * Side effects: INSERT into invoices.
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param baseRow - The invoice row fields except invoice_number.
 * @returns The inserted invoice with id and invoice_number.
 * @throws Error if no number can be reserved within the retry limit.
 */
async function insertInvoiceWithUniqueNumber(
  adminClient: AnySupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseRow: Record<string, any>
): Promise<{ id: string; invoice_number: string }> {
  const maxAttempts = 10;
  const { count } = await adminClient
    .from("invoices")
    .select("id", { count: "exact", head: true });

  let nextInvoiceNumber = (count ?? 0) + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = `INV-${String(nextInvoiceNumber).padStart(5, "0")}`;
    const { data, error } = await adminClient
      .from("invoices")
      .insert({ ...baseRow, invoice_number: candidate })
      .select("id, invoice_number")
      .single();

    if (!error && data) {
      return {
        id: data.id as string,
        invoice_number: data.invoice_number as string,
      };
    }

    if (error?.code === "23505") {
      nextInvoiceNumber += 1;
      continue;
    }

    throw new Error(`Invoice insert failed: ${error?.message ?? "unknown error"}`);
  }

  throw new Error(`Failed to reserve a unique invoice number after ${maxAttempts} attempts.`);
}

/** Parameters for createAndSendInvoice — the full set of caller-verified, server-authoritative fields. */
export interface CreateAndSendInvoiceParams {
  sessionId: string;
  instructorId: string;
  instructorName: string | null;
  invoiceType: "individual" | "group";
  recipientName: string;
  recipientEmail: string;
  companyName: string | null;
  studentCount: number;
  /** Per-student price used for the primary PayPal line item and the invoice row. */
  amountPerStudent: number;
  /** Authoritative total. May exceed amountPerStudent * studentCount when extraLineItems are present. */
  totalAmount: number;
  /** True whenever totalAmount isn't a plain amountPerStudent * studentCount multiplication (custom price or extra line items). */
  customPrice: boolean;
  notes: string | null;
  className: string;
  classDate: string;
  locationName: string;
  locationCity: string;
  locationState: string;
  /** Who to attribute the invoice_activity_log "created"/"sent" entries to. */
  actorId: string;
  /** Additional PayPal line items beyond the per-student class fee, e.g. a travel fee. */
  extraLineItems?: InvoiceLineItem[];
  /**
   * Replaces the default "className × studentCount @ amountPerStudent" PayPal
   * line item. Used by team/corporate bookings, which are billed as a flat total
   * with no per-head breakdown and are stored with studentCount = 0 (so they
   * never consume class capacity in book_spot) — a quantity-0 PayPal line would
   * otherwise be invalid.
   */
  primaryLineItem?: InvoiceLineItem;
}

export type CreateAndSendInvoiceResult =
  | { success: true; invoiceId: string; invoiceNumber: string }
  | { success: false; error: string };

/**
 * Creates a SuperHeroCPR business PayPal invoice for a class session, inserts
 * the invoices row, logs activity, and emails the recipient.
 * Side effects: PayPal invoice creation, DB insert, activity log inserts, Resend email.
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param params - Invoice details. Caller is responsible for validation, auth, and pricing derivation.
 */
export async function createAndSendInvoice(
  adminClient: AnySupabaseClient,
  params: CreateAndSendInvoiceParams
): Promise<CreateAndSendInvoiceResult> {
  const { count: invoiceCount } = await adminClient
    .from("invoices")
    .select("id", { count: "exact", head: true });
  const invoiceNumber = `INV-${String((invoiceCount ?? 0) + 1).padStart(5, "0")}`;

  const items: InvoiceLineItem[] = [
    params.primaryLineItem ?? {
      name: params.className,
      quantity: params.studentCount,
      unitAmount: params.amountPerStudent,
    },
    ...(params.extraLineItems ?? []),
  ];

  const { platformInvoiceId, paymentLink } = await createBusinessPayPalInvoice({
    recipientEmail: params.recipientEmail,
    invoiceNumber,
    items,
  });

  if (!platformInvoiceId || !paymentLink) {
    return {
      success: false,
      error:
        "We couldn't create the invoice in PayPal. Please check the business PayPal settings and try again.",
    };
  }

  let invoice: { id: string; invoice_number: string };
  try {
    invoice = await insertInvoiceWithUniqueNumber(adminClient, {
      class_session_id: params.sessionId,
      instructor_id: params.instructorId,
      invoice_type: params.invoiceType,
      recipient_name: params.recipientName,
      recipient_email: params.recipientEmail,
      company_name: params.companyName,
      student_count: params.studentCount,
      amount_per_student: params.amountPerStudent,
      custom_price: params.customPrice,
      total_amount: params.totalAmount,
      payment_platform: "paypal",
      platform_invoice_id: platformInvoiceId,
      notes: params.notes,
      status: "sent",
    });
  } catch (err) {
    console.error("[invoice-actions] Invoice insert failed:", err);
    return { success: false, error: "Failed to create invoice. Please try again." };
  }

  await adminClient.from("invoice_activity_log").insert([
    {
      invoice_id: invoice.id,
      actor_id: params.actorId,
      action: "created",
      notes: "Business PayPal invoice created",
    },
    {
      invoice_id: invoice.id,
      actor_id: params.actorId,
      action: "sent",
      notes: null,
    },
  ]);

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html } = invoiceEmail({
      invoiceNumber: invoice.invoice_number,
      recipientName: params.recipientName,
      invoiceType: params.invoiceType,
      companyName: params.companyName,
      studentCount: params.studentCount,
      totalAmount: params.totalAmount,
      className: params.className,
      classDate: params.classDate,
      locationName: params.locationName,
      locationCity: params.locationCity,
      locationState: params.locationState,
      instructorName: params.instructorName,
      notes: params.notes,
      paymentLink,
    });
    await resend.emails
      .send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: params.recipientEmail,
        subject,
        html,
        ...(params.invoiceType === "group" && {
          attachments: [
            {
              filename: "roster-template.csv",
              content: Buffer.from(
                [
                  `"First Name","Last Name","Email","Phone","Employer"`,
                  `"Jane","Smith","jane.smith@example.com","555-867-5309","Acme Hospital"`,
                  `"John","Doe","john.doe@example.com","",""`,
                ].join("\r\n")
              ),
            },
          ],
        }),
      })
      .catch((err: unknown) => {
        console.error("[invoice-actions] Invoice email failed (non-fatal):", err);
      });
  }

  return { success: true, invoiceId: invoice.id, invoiceNumber: invoice.invoice_number };
}

// ---------------------------------------------------------------------------
// Mark-paid
// ---------------------------------------------------------------------------

export interface MarkInvoicePaidParams {
  invoiceId: string;
  /** invoice_activity_log.actor_id is NOT NULL — for webhook-triggered calls
   * (no human actor), pass the invoice's own instructor_id. */
  actorId: string;
  /** Distinguishes a genuine admin/instructor click from an automated PayPal webhook, for logging only. */
  source: "manual" | "webhook";
}

export type MarkInvoicePaidResult =
  | { success: true; paidAt: string | undefined }
  | { success: false; error: string; status: 404 | 400 | 500 };

/**
 * Marks an invoice paid via the mark_invoice_paid() Postgres RPC, then records
 * instructor earnings, fires an immediate payout if configured, and sends
 * paid-notification emails to both the instructor and the invoice recipient.
 * Shared by POST /api/invoices/mark-paid (manual) and the PayPal paid-invoice
 * webhook, so both paths behave identically.
 * Side effects: invoices/bookings/instructor_earnings/invoice_activity_log
 * writes via the RPC, possible payout trigger, two best-effort emails.
 * @param adminClient - Admin Supabase client (RLS-bypassing).
 * @param params - Invoice id, the actor to attribute the paid action to, and the trigger source.
 */
export async function markInvoicePaidAndNotify(
  adminClient: AnySupabaseClient,
  params: MarkInvoicePaidParams
): Promise<MarkInvoicePaidResult> {
  const { data: invoice } = await adminClient
    .from("invoices")
    .select(`
      id, instructor_id, invoice_number, student_count, invoice_type,
      recipient_name, recipient_email, status, total_amount, class_session_id,
      profiles ( email, first_name, last_name ),
      class_sessions ( starts_at, class_types ( name ) )
    `)
    .eq("id", params.invoiceId)
    .single();

  if (!invoice) {
    return { success: false, error: "Invoice not found", status: 404 };
  }

  if (invoice.status !== "sent") {
    return { success: false, error: "Invoice is not in sent status", status: 400 };
  }

  const { data: rpcResult, error: rpcError } = await adminClient.rpc("mark_invoice_paid", {
    p_invoice_id: params.invoiceId,
    p_actor_id: params.actorId,
  });

  if (rpcError) {
    if (rpcError.message?.includes("invoice_not_found")) {
      return { success: false, error: "Invoice not found", status: 404 };
    }
    if (rpcError.message?.includes("invoice_not_sent")) {
      return { success: false, error: "Invoice is not in sent status", status: 400 };
    }
    console.error("[invoice-actions] mark_invoice_paid RPC error:", rpcError);
    return { success: false, error: "Failed to mark invoice as paid. Please try again.", status: 500 };
  }

  const paidAt = (rpcResult as { paid_at?: string } | null)?.paid_at;

  await recordInvoiceEarning(adminClient, {
    instructorId: invoice.instructor_id,
    invoiceId: invoice.id,
    grossAmount: Number(invoice.total_amount),
    note:
      params.source === "webhook"
        ? `Invoice ${invoice.invoice_number} marked paid automatically via PayPal webhook`
        : `Invoice ${invoice.invoice_number} marked paid`,
  }).catch((err: unknown) => {
    console.error("[invoice-actions] CRITICAL: instructor earning insert failed", {
      invoiceId: params.invoiceId,
      invoiceNumber: invoice.invoice_number,
      error: err,
    });
  });

  // Fire a payout immediately if the system is configured for immediate trigger mode.
  await maybeTriggerImmediatePayout(adminClient);

  const instructorProfile = invoice.profiles as unknown as {
    email: string;
    first_name: string;
    last_name: string;
  } | null;

  const session = invoice.class_sessions as unknown as {
    starts_at: string;
    class_types: { name: string } | { name: string }[] | null;
  } | null;
  const classType = Array.isArray(session?.class_types)
    ? session?.class_types[0]
    : session?.class_types;

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);

    // Notify the instructor (best-effort — a failed email shouldn't reverse the paid status)
    if (instructorProfile?.email) {
      const { subject, html } = invoicePaidEmail({
        firstName: instructorProfile.first_name,
        invoiceNumber: invoice.invoice_number,
        recipientName: invoice.recipient_name,
        studentCount: invoice.student_count as number,
      });
      await resend.emails
        .send({
          from: process.env.RESEND_FROM_EMAIL!,
          to: instructorProfile.email,
          subject,
          html,
        })
        .catch((err: unknown) => {
          console.error("[invoice-actions] Instructor paid-notification email failed (non-fatal):", err);
        });
    }

    // Notify the invoice recipient — the only customer-facing confirmation that
    // payment was received, including the roster-upload link for group invoices.
    if (invoice.recipient_email && session && classType) {
      const { subject, html } = invoicePaymentConfirmedCustomerEmail({
        recipientName: invoice.recipient_name,
        invoiceNumber: invoice.invoice_number,
        invoiceType: invoice.invoice_type as "individual" | "group",
        className: classType.name,
        classDate: session.starts_at,
        totalAmount: Number(invoice.total_amount),
      });
      await resend.emails
        .send({
          from: process.env.RESEND_FROM_EMAIL!,
          to: invoice.recipient_email,
          subject,
          html,
        })
        .catch((err: unknown) => {
          console.error("[invoice-actions] Customer payment-confirmed email failed (non-fatal):", err);
        });
    }
  }

  return { success: true, paidAt };
}
