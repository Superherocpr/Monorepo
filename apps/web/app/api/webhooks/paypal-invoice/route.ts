/**
 * POST /api/webhooks/paypal-invoice
 * Called by: PayPal (server-to-server webhook), for the business PayPal
 * account's INVOICING.INVOICE.PAID event.
 * Auth: none via user session — the request is authenticated entirely by
 * verifying PayPal's signature headers against PAYPAL_INVOICE_WEBHOOK_ID.
 * Requests that fail signature verification are rejected outright.
 *
 * Set up in the PayPal business account dashboard: a webhook subscription
 * pointing at this URL, subscribed to at least INVOICING.INVOICE.PAID, whose
 * webhook ID matches the PAYPAL_INVOICE_WEBHOOK_ID env var. This is a
 * separate webhook subscription/ID from any other PayPal webhook this
 * account may already have registered for other event types.
 *
 * On a verified INVOICING.INVOICE.PAID event, looks up the matching invoices
 * row by platform_invoice_id and delegates to markInvoicePaidAndNotify() —
 * the same function POST /api/invoices/mark-paid uses — so a PayPal-detected
 * payment behaves identically to an admin's manual "Mark Paid" click.
 *
 * Idempotent by construction: mark_invoice_paid() (migration 0016) raises
 * invoice_not_sent when called on an already-paid invoice. This route treats
 * that as a successful no-op and acks the webhook, so PayPal's automatic
 * retries (e.g. redelivering the same event, or firing again after a manual
 * mark-paid already ran) never double-process a payment.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { verifyPayPalWebhookSignature } from "@/lib/paypal";
import { markInvoicePaidAndNotify } from "@/lib/invoice-actions";

/** Minimal shape read from the PayPal webhook event body. */
interface PayPalWebhookEvent {
  event_type?: string;
  resource?: { id?: string };
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(rawBody) as PayPalWebhookEvent;
  } catch {
    return Response.json({ received: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const transmissionId = request.headers.get("paypal-transmission-id");
  const transmissionTime = request.headers.get("paypal-transmission-time");
  const certUrl = request.headers.get("paypal-cert-url");
  const authAlgo = request.headers.get("paypal-auth-algo");
  const transmissionSig = request.headers.get("paypal-transmission-sig");

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return Response.json(
      { received: false, error: "Missing PayPal transmission headers" },
      { status: 400 }
    );
  }

  let verified = false;
  try {
    verified = await verifyPayPalWebhookSignature(
      { transmissionId, transmissionTime, certUrl, authAlgo, transmissionSig },
      event
    );
  } catch (err) {
    console.error("[webhooks/paypal-invoice] Signature verification request failed:", err);
    // 500 so PayPal retries — this is a transient failure on our end (e.g. PayPal auth outage),
    // not evidence the request is illegitimate.
    return Response.json({ received: false, error: "Verification unavailable" }, { status: 500 });
  }

  if (!verified) {
    console.warn("[webhooks/paypal-invoice] Signature verification failed for a webhook request.");
    return Response.json({ received: false, error: "Invalid signature" }, { status: 400 });
  }

  // Ack and ignore event types we don't act on, so PayPal stops retrying them.
  if (event.event_type !== "INVOICING.INVOICE.PAID") {
    return Response.json({ received: true, ignored: true });
  }

  const platformInvoiceId = event.resource?.id;
  if (!platformInvoiceId) {
    return Response.json({ received: true, ignored: true });
  }

  const adminClient = await createAdminClient();
  const { data: invoiceRow } = await adminClient
    .from("invoices")
    .select("id, instructor_id")
    .eq("platform_invoice_id", platformInvoiceId)
    .eq("payment_platform", "paypal")
    .maybeSingle();

  if (!invoiceRow) {
    console.warn(
      "[webhooks/paypal-invoice] No matching invoice for platform_invoice_id:",
      platformInvoiceId
    );
    return Response.json({ received: true, ignored: true });
  }

  // No human actor triggered this — attribute the invoice_activity_log entry
  // to the invoice's own instructor (actor_id is NOT NULL). The "webhook"
  // source tag on the earnings note distinguishes this from a manual click.
  const result = await markInvoicePaidAndNotify(adminClient, {
    invoiceId: invoiceRow.id,
    actorId: invoiceRow.instructor_id,
    source: "webhook",
  });

  if (!result.success) {
    if (result.status === 400 || result.status === 404) {
      // Already paid/cancelled, or the row disappeared — idempotent no-op.
      return Response.json({ received: true, alreadyHandled: true });
    }
    // Genuine failure (RPC/DB error) — return 500 so PayPal retries delivery.
    console.error("[webhooks/paypal-invoice] markInvoicePaidAndNotify failed:", result.error);
    return Response.json({ received: false, error: result.error }, { status: 500 });
  }

  return Response.json({ received: true, paidAt: result.paidAt });
}
