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

import { sendEmail } from "@/lib/send-email";
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
  /** Why the attempt failed. Null on success. Never shown to a customer. */
  error: string | null;
  /**
   * Set when PayPal accepted the draft but the follow-up send call failed. The
   * draft exists on the merchant account and is invisible to this app, so a
   * blind retry would leave a duplicate behind — the caller surfaces this id so
   * an admin can send or delete that draft in PayPal by hand.
   */
  strandedDraftId?: string;
}

/** Parameters needed to create an invoice on PayPal. */
interface PlatformCreateParams {
  recipientEmail: string;
  invoiceNumber: string;
  items: InvoiceLineItem[];
}

/**
 * Pulls the PayPal invoice id out of a create-draft-invoice response body.
 *
 * PayPal answers `POST /v2/invoicing/invoices` in one of two shapes depending on
 * the `Prefer` header. `return=representation` yields the full invoice object
 * with a top-level `id`; the DEFAULT, `return=minimal`, yields only
 * `{ rel, href, method }`, where the id is the last path segment of `href`.
 *
 * This distinction is not academic. Until 2026-09-05 this module sent no
 * `Prefer` header and read `body.id`, which is absent from the minimal shape —
 * so every real invoice creation drew a 201 from PayPal, found no id, and
 * reported "we couldn't create the invoice in PayPal" while leaving an unsent
 * draft on the merchant account. No production invoice had ever been created.
 *
 * We now request the representation AND read both shapes, so a merchant account
 * or API version that ignores the header cannot resurrect that failure.
 *
 * @param body - Parsed JSON body from the create call.
 * @returns The PayPal invoice id, or null when neither shape yields one.
 */
function extractPayPalInvoiceId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;

  if (typeof record.id === "string" && record.id) return record.id;

  if (typeof record.href === "string" && record.href) {
    const segments = record.href.split("?")[0].split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return last && last !== "invoices" ? last : null;
  }

  return null;
}

/**
 * Creates and sends a PayPal invoice from the business PayPal account.
 *
 * Side effects: creates a PayPal invoice and sends it to the recipient.
 *
 * Every failure path returns a populated `error` — there is deliberately no
 * silent null return here, because a silent one is what hid the missing-id bug
 * described on extractPayPalInvoiceId for the life of the feature.
 *
 * @param params - Recipient, invoice number, and line items for the PayPal payload.
 * @returns PayPal invoice id and hosted payment link, or null fields plus a reason.
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
        // Ask for the full invoice object so the response carries a top-level
        // `id`. Without this PayPal returns the minimal href-only shape.
        Prefer: "return=representation",
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
      return {
        platformInvoiceId: null,
        paymentLink: null,
        error: `PayPal rejected the invoice (HTTP ${createRes.status}).`,
      };
    }

    const createBody: unknown = await createRes.json().catch(() => null);
    const platformInvoiceId = extractPayPalInvoiceId(createBody);

    if (!platformInvoiceId) {
      // PayPal accepted the request but we cannot address the result. Log the
      // body so the next shape change is diagnosable from one log line.
      console.error(
        "[invoice-actions] PayPal invoice create returned no usable id:",
        JSON.stringify(createBody)
      );
      return {
        platformInvoiceId: null,
        paymentLink: null,
        error: "PayPal accepted the invoice but returned no invoice id.",
      };
    }

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
      return {
        platformInvoiceId: null,
        paymentLink: null,
        error: `PayPal created the invoice but would not send it (HTTP ${sendRes.status}).`,
        strandedDraftId: platformInvoiceId,
      };
    }

    return {
      platformInvoiceId,
      paymentLink: `${connectBase}/invoice/p/#${platformInvoiceId}`,
      error: null,
    };
  } catch (err) {
    console.error("[invoice-actions] PayPal invoice request failed:", err);
    return {
      platformInvoiceId: null,
      paymentLink: null,
      error: "Could not reach PayPal to raise the invoice.",
    };
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

  const platform = await createBusinessPayPalInvoice({
    recipientEmail: params.recipientEmail,
    invoiceNumber,
    items,
  });

  const { platformInvoiceId, paymentLink } = platform;

  if (!platformInvoiceId || !paymentLink) {
    // The reason is one of our own fixed strings, never raw PayPal output, so
    // it is safe to hand to the admin UI that triggered this (CLAUDE.md §9).
    const reason = platform.error ?? "PayPal did not return a usable invoice.";
    return {
      success: false,
      error: platform.strandedDraftId
        ? `${reason} A draft invoice (${platform.strandedDraftId}) is sitting unsent in PayPal — send or delete it there before retrying, or you will bill twice.`
        : `${reason} Please check the business PayPal settings and try again.`,
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

  {
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
    await sendEmail({
      context: "invoice-actions:invoice",
      to: params.recipientEmail,
      subject,
      html,
      idempotencyKey: `invoice-sent-${invoice.id}`,
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

  // Both sends are best-effort — a failed email must not reverse the paid status.
  // Keyed on the invoice so a webhook redelivery cannot double-notify.
  if (instructorProfile?.email) {
    const { subject, html } = invoicePaidEmail({
      firstName: instructorProfile.first_name,
      invoiceNumber: invoice.invoice_number,
      recipientName: invoice.recipient_name,
      studentCount: invoice.student_count as number,
    });
    await sendEmail({
      context: "invoice-actions:instructor-paid",
      to: instructorProfile.email,
      subject,
      html,
      idempotencyKey: `invoice-paid-instructor-${invoice.id}`,
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
    await sendEmail({
      context: "invoice-actions:customer-paid",
      to: invoice.recipient_email,
      subject,
      html,
      idempotencyKey: `invoice-paid-customer-${invoice.id}`,
    });
  }

  return { success: true, paidAt };
}
