/**
 * POST /api/webhooks/paypal-payouts
 * Called by: PayPal (server-to-server webhook) for Payouts batch and item events.
 * Auth: none via user session — the request is authenticated entirely by
 * verifying PayPal's signature headers against PAYPAL_PAYOUTS_WEBHOOK_ID.
 * Requests that fail signature verification are rejected outright.
 *
 * WHY THIS EXISTS
 * PayPal accepting a Payouts batch is not the same as PayPal delivering it. A
 * batch can be denied hours later — risk review, funding failure, an account
 * limitation — with the funds returned to the business account. Polling could
 * only find that on the next sync; these webhooks report it as it happens.
 *
 * SETUP (per environment, sandbox and live are separate)
 *   PayPal dashboard → Apps & Credentials → your REST app → Webhooks → Add.
 *   Point it at this URL and subscribe to:
 *     PAYMENT.PAYOUTSBATCH.DENIED / .SUCCESS / .PROCESSING
 *     PAYMENT.PAYOUTS-ITEM.SUCCEEDED / .DENIED / .BLOCKED / .FAILED
 *     PAYMENT.PAYOUTS-ITEM.RETURNED / .UNCLAIMED / .REFUNDED / .CANCELED / .HELD
 *   Then set the resulting webhook ID as PAYPAL_PAYOUTS_WEBHOOK_ID. This is a
 *   distinct subscription and ID from PAYPAL_INVOICE_WEBHOOK_ID.
 *
 * Rather than trusting the event payload's own status fields, every recognised
 * event triggers a full re-read of the batch from PayPal via
 * reconcilePayoutBatch() — the same code path the sync route and the hourly cron
 * use. That keeps one interpretation of PayPal's statuses and makes duplicate or
 * out-of-order deliveries harmless.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { verifyPayPalWebhookSignature } from "@/lib/paypal";
import { reconcilePayoutBatch } from "@/lib/payout-reconcile";
import { notifyInstructorsPaid, notifyPayoutDenied } from "@/lib/payout-notify";
import type { PayoutDenialSource } from "@/types/payouts";

/** Payout event types this route acts on. Anything else is acked and ignored. */
const HANDLED_EVENT_PREFIXES = [
  "PAYMENT.PAYOUTSBATCH.",
  "PAYMENT.PAYOUTS-ITEM.",
];

/** Minimal shape read from a PayPal payouts webhook event body. */
interface PayPalPayoutsWebhookEvent {
  id?: string;
  event_type?: string;
  resource?: {
    /** Present on item events. */
    payout_batch_id?: string;
    payout_item_id?: string;
    payout_item?: { sender_item_id?: string };
    /** Present on batch events. */
    batch_header?: {
      payout_batch_id?: string;
      sender_batch_header?: { sender_batch_id?: string };
      batch_status?: string;
    };
  };
}

/**
 * Resolves the internal payout batch for a webhook event.
 *
 * Looks up PayPal's payout_batch_id first, then falls back to our own
 * sender_batch_id. That fallback matters: a webhook can arrive before
 * /api/payouts/create has finished writing paypal_payout_batch_id, and without
 * it a fast denial would be dropped as an unknown batch.
 *
 * @param adminClient - Admin Supabase client.
 * @param event - Parsed webhook event.
 * @returns The internal batch id and PayPal batch id, or null when unknown.
 */
async function resolveBatch(
  adminClient: Awaited<ReturnType<typeof createAdminClient>>,
  event: PayPalPayoutsWebhookEvent
): Promise<{ id: string; paypalPayoutBatchId: string } | null> {
  const paypalBatchId =
    event.resource?.batch_header?.payout_batch_id ?? event.resource?.payout_batch_id ?? null;
  const senderBatchId =
    event.resource?.batch_header?.sender_batch_header?.sender_batch_id ?? null;

  if (paypalBatchId) {
    const { data } = await adminClient
      .from("instructor_payout_batches")
      .select("id, paypal_payout_batch_id")
      .eq("paypal_payout_batch_id", paypalBatchId)
      .maybeSingle();

    const row = data as { id: string; paypal_payout_batch_id: string | null } | null;
    if (row) {
      return { id: row.id, paypalPayoutBatchId: row.paypal_payout_batch_id ?? paypalBatchId };
    }
  }

  if (senderBatchId) {
    const { data } = await adminClient
      .from("instructor_payout_batches")
      .select("id, paypal_payout_batch_id")
      .eq("sender_batch_id", senderBatchId)
      .maybeSingle();

    const row = data as { id: string; paypal_payout_batch_id: string | null } | null;
    // Without a PayPal batch id there is nothing to reconcile against yet.
    const resolvedPaypalId = row?.paypal_payout_batch_id ?? paypalBatchId;
    if (row && resolvedPaypalId) {
      return { id: row.id, paypalPayoutBatchId: resolvedPaypalId };
    }
  }

  return null;
}

/**
 * Handles a verified PayPal Payouts webhook event.
 * Side effects: PayPal batch re-read, payout item/earning/attempt/batch writes,
 * best-effort notification emails, and an idempotency row.
 * @param request - The inbound webhook request from PayPal.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  let event: PayPalPayoutsWebhookEvent;
  try {
    event = JSON.parse(rawBody) as PayPalPayoutsWebhookEvent;
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
      event,
      process.env.PAYPAL_PAYOUTS_WEBHOOK_ID
    );
  } catch (err) {
    console.error("[webhooks/paypal-payouts] Signature verification request failed:", err);
    // 500 so PayPal retries — a transient failure on our end, not evidence the
    // request is illegitimate.
    return Response.json({ received: false, error: "Verification unavailable" }, { status: 500 });
  }

  if (!verified) {
    console.warn("[webhooks/paypal-payouts] Signature verification failed for a webhook request.");
    return Response.json({ received: false, error: "Invalid signature" }, { status: 400 });
  }

  const eventType = event.event_type ?? "";
  if (!HANDLED_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix))) {
    // Ack so PayPal stops retrying event types we do not act on.
    return Response.json({ received: true, ignored: true });
  }

  const adminClient = await createAdminClient();

  // Replay protection. PayPal redelivers on any non-2xx, so the same denial can
  // arrive repeatedly; the event id primary key makes the second one a no-op.
  const eventId = event.id;
  if (eventId) {
    const { error: insertError } = await adminClient.from("processed_webhook_events").insert({
      event_id: eventId,
      event_type: eventType,
      resource_id:
        event.resource?.batch_header?.payout_batch_id ??
        event.resource?.payout_batch_id ??
        event.resource?.payout_item_id ??
        null,
    });

    // 23505 = unique violation: this event was already handled.
    if (insertError?.code === "23505") {
      return Response.json({ received: true, alreadyHandled: true });
    }
    if (insertError) {
      console.error("[webhooks/paypal-payouts] Idempotency insert failed:", insertError);
      // Fall through: reconciliation is itself idempotent, so acting twice is
      // safer than dropping a denial.
    }
  }

  const batch = await resolveBatch(adminClient, event);
  if (!batch) {
    console.warn(
      "[webhooks/paypal-payouts] No matching payout batch for event:",
      eventType,
      event.resource?.batch_header?.payout_batch_id ?? event.resource?.payout_batch_id
    );
    return Response.json({ received: true, ignored: true });
  }

  try {
    const result = await reconcilePayoutBatch(adminClient, batch, {
      source: "webhook" as PayoutDenialSource,
      actorId: null,
    });

    await notifyInstructorsPaid(adminClient, result.newlyCompletedItemIds);

    if (result.localBatchStatus === "denied") {
      console.warn(
        `[webhooks/paypal-payouts] Batch ${batch.id} denied by PayPal (${result.paypalBatchStatus}); ${result.releasedCount} item(s) re-queued.`
      );
      await notifyPayoutDenied(adminClient, batch.id, result.paypalBatchStatus);
    }

    return Response.json({
      received: true,
      batchId: batch.id,
      localBatchStatus: result.localBatchStatus,
      releasedItems: result.releasedCount,
    });
  } catch (err) {
    console.error("[webhooks/paypal-payouts] Reconciliation failed:", err);
    // 500 so PayPal retries — the outcome of this batch is important enough to
    // not lose to a transient PayPal or database error.
    return Response.json(
      { received: false, error: "Reconciliation failed" },
      { status: 500 }
    );
  }
}
