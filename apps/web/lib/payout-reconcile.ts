/**
 * Payout reconciliation — turning PayPal's view of a payout batch into ours.
 *
 * Shared by three callers so they can never disagree about what a PayPal status
 * means:
 *   - POST /api/payouts/sync            (admin click, and the hourly cron job)
 *   - POST /api/webhooks/paypal-payouts (PayPal pushes the outcome to us)
 *   - POST /api/payouts/deny            (an admin asserts a denial manually)
 *
 * The central rule: an item whose funds returned to the business account
 * releases its earnings back to `pending` so they can be paid again. An item
 * still in flight — including UNCLAIMED, where PayPal holds the money for 30
 * days — must NOT release, or the same money gets sent twice.
 *
 * Server-side only; never import from a client component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPayPalPayoutBatchStatus } from "@/lib/paypal-payouts";
import type {
  PayoutAttemptOutcome,
  PayoutDenialSource,
  PayoutItemStatus,
} from "@/types/payouts";

/** Admin Supabase client shape used by reconciliation writes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, "public", any>;

/** Days PayPal holds an UNCLAIMED payout before returning the funds. */
const UNCLAIMED_HOLD_DAYS = 30;

/**
 * Maps a PayPal `transaction_status` to our local payout item status.
 *
 * PayPal's vocabulary conflates "in flight" with "finished", so this mapping is
 * the single place that decides whether money is still committed:
 *   - SUCCESS                                → completed (delivered)
 *   - PENDING / PROCESSING / ONHOLD / HELD   → assumed_complete (still in flight)
 *   - UNCLAIMED                              → unclaimed (committed, 30-day hold)
 *   - DENIED / BLOCKED / RETURNED / REFUNDED
 *     / REVERSED / CANCELED                  → denied (funds came back)
 *   - FAILED                                 → failed (never sent)
 *
 * Anything unrecognised is treated as still in flight, which is the safe
 * default: it withholds the earnings rather than risking a duplicate payout.
 *
 * @param transactionStatus - Raw `transaction_status` from PayPal.
 * @returns The local item status to store.
 */
export function mapPayPalItemStatus(transactionStatus: string): PayoutItemStatus {
  switch (transactionStatus.toUpperCase()) {
    case "SUCCESS":
      return "completed";
    case "UNCLAIMED":
      return "unclaimed";
    case "DENIED":
    case "BLOCKED":
    case "RETURNED":
    case "REFUNDED":
    case "REVERSED":
    case "CANCELED":
    case "CANCELLED":
      return "denied";
    case "FAILED":
      return "failed";
    case "PENDING":
    case "PROCESSING":
    case "ONHOLD":
    case "HELD":
      return "assumed_complete";
    default:
      return "assumed_complete";
  }
}

/**
 * Whether a local item status means the money came back and the earnings should
 * return to the payable pool.
 * @param status - Local payout item status.
 */
export function releasesEarnings(status: PayoutItemStatus): boolean {
  return status === "denied" || status === "failed";
}

/** Whether a local item status means PayPal is still holding or moving the money. */
export function isInFlight(status: PayoutItemStatus): boolean {
  return status === "assumed_complete" || status === "unclaimed" || status === "pending";
}

/** Maps a local item status onto the attempt-history outcome vocabulary. */
function attemptOutcomeFor(status: PayoutItemStatus): PayoutAttemptOutcome {
  switch (status) {
    case "completed":
      return "completed";
    case "denied":
      return "denied";
    case "failed":
      return "failed";
    case "unclaimed":
      return "unclaimed";
    case "needs_review":
      return "needs_review";
    default:
      return "submitted";
  }
}

/** Options describing who or what recorded an outcome. */
interface ReconcileSource {
  /** Where this determination came from. */
  source: PayoutDenialSource;
  /** Super admin who acted, when the source is manual. */
  actorId?: string | null;
  /** Reason text stored on denied rows. */
  reason?: string | null;
}

/**
 * Applies one item's resolved status to its item row, earnings, and attempt history.
 *
 * Side effects: UPDATEs instructor_payout_items, instructor_earnings, and
 * instructor_payout_attempts.
 *
 * @param adminClient - Admin Supabase client.
 * @param params - Item identity, resolved status, PayPal metadata, and source.
 */
async function applyItemStatus(
  adminClient: AnySupabaseClient,
  params: {
    itemId: string;
    batchId: string;
    status: PayoutItemStatus;
    paypalItemId?: string | null;
    errorMessage?: string | null;
    feeAmount?: number | null;
    timeProcessed?: string | null;
    origin: ReconcileSource;
  }
): Promise<void> {
  const { itemId, batchId, status, origin } = params;
  const now = new Date().toISOString();

  // PayPal holds unclaimed funds for 30 days from processing, then returns them.
  // Recording the expiry stops these sitting in limbo with no visible deadline.
  const unclaimedExpiresAt =
    status === "unclaimed" && params.timeProcessed
      ? new Date(
          new Date(params.timeProcessed).getTime() + UNCLAIMED_HOLD_DAYS * 86_400_000
        ).toISOString()
      : null;

  await adminClient
    .from("instructor_payout_items")
    .update({
      status,
      ...(params.paypalItemId !== undefined
        ? { paypal_payout_item_id: params.paypalItemId }
        : {}),
      error_message: params.errorMessage ?? null,
      ...(params.feeAmount !== undefined && params.feeAmount !== null
        ? { paypal_fee_amount: params.feeAmount }
        : {}),
      ...(status === "unclaimed" ? { unclaimed_expires_at: unclaimedExpiresAt } : {}),
      ...(status === "denied"
        ? {
            denied_at: now,
            denied_by: origin.actorId ?? null,
            denial_source: origin.source,
            denial_reason: origin.reason ?? params.errorMessage ?? null,
          }
        : {}),
      updated_at: now,
    })
    .eq("id", itemId)
    .eq("payout_batch_id", batchId);

  if (status === "completed") {
    await adminClient
      .from("instructor_earnings")
      .update({ status: "paid", updated_at: now })
      .eq("payout_item_id", itemId)
      .eq("status", "payout_pending");
  }

  if (releasesEarnings(status)) {
    // Funds are back with the business account — return the earnings to the
    // payable pool. The attempt row below preserves the link to this batch, so
    // clearing the pointers here does not lose the retry history.
    await adminClient
      .from("instructor_earnings")
      .update({
        status: "pending",
        payout_batch_id: null,
        payout_item_id: null,
        updated_at: now,
      })
      .eq("payout_item_id", itemId)
      .eq("status", "payout_pending");
  }

  await adminClient
    .from("instructor_payout_attempts")
    .update({
      outcome: attemptOutcomeFor(status),
      resolved_at: isInFlight(status) ? null : now,
      ...(params.errorMessage ? { note: params.errorMessage } : {}),
    })
    .eq("payout_batch_id", batchId)
    .eq("payout_item_id", itemId);
}

/** Result of reconciling one batch against PayPal. */
export interface ReconcileBatchResult {
  /** Number of payout items PayPal reported. */
  itemCount: number;
  /** Raw PayPal batch status. */
  paypalBatchStatus: string;
  /** Local batch status written as a result. */
  localBatchStatus: string;
  /** Items whose funds returned and whose earnings were released. */
  releasedCount: number;
  /**
   * Items that reached `completed` on this pass and had not been completed
   * before. Used to send each instructor exactly one payment-confirmed email,
   * however many times reconciliation runs afterwards.
   */
  newlyCompletedItemIds: string[];
}

/**
 * Recomputes and writes a batch's local status from its item rows.
 *
 * Called after item statuses are applied, so it reads the freshly written rows
 * rather than trusting PayPal's batch header alone.
 *
 * Side effects: UPDATE instructor_payout_batches.
 *
 * @param adminClient - Admin Supabase client.
 * @param batchId - Internal payout batch id.
 * @param paypalBatchStatus - Raw batch status PayPal reported.
 * @param feeTotal - Total batch fee PayPal reported, if any.
 * @param origin - Who or what triggered this reconciliation.
 * @returns The local batch status that was written.
 */
async function writeBatchStatus(
  adminClient: AnySupabaseClient,
  batchId: string,
  paypalBatchStatus: string,
  feeTotal: number | null,
  origin: ReconcileSource
): Promise<string> {
  const now = new Date().toISOString();
  const { data: itemRows } = await adminClient
    .from("instructor_payout_items")
    .select("status")
    .eq("payout_batch_id", batchId);

  const statuses = ((itemRows ?? []) as { status: PayoutItemStatus }[]).map((r) => r.status);
  const inFlight = statuses.filter(isInFlight).length;
  const completed = statuses.filter((s) => s === "completed").length;
  const returned = statuses.filter(releasesEarnings).length;

  const batchDenied =
    paypalBatchStatus === "DENIED" ||
    paypalBatchStatus === "CANCELED" ||
    paypalBatchStatus === "CANCELLED";

  let localStatus: string;
  let errorMessage: string | null = null;

  if (batchDenied) {
    localStatus = "denied";
    errorMessage = `PayPal denied the entire batch (${paypalBatchStatus}). Funds were returned to the business account.`;
  } else if (inFlight > 0) {
    localStatus = "assumed_complete";
  } else if (returned > 0 && completed === 0) {
    localStatus = "denied";
    errorMessage = "Every payout item in this batch was returned by PayPal.";
  } else if (returned > 0) {
    // Mixed outcome: some instructors were paid, some were not. The batch is
    // finished, so it is not itself retryable — the released earnings flow into
    // the next normal payout run instead.
    localStatus = "completed";
    errorMessage = `${returned} of ${statuses.length} payout items were returned by PayPal and have been re-queued.`;
  } else {
    localStatus = "completed";
  }

  await adminClient
    .from("instructor_payout_batches")
    .update({
      status: localStatus,
      error_message: errorMessage,
      ...(feeTotal !== null ? { paypal_fee_total: feeTotal } : {}),
      completed_at: localStatus === "completed" ? now : null,
      ...(localStatus === "denied"
        ? {
            denied_at: now,
            denied_by: origin.actorId ?? null,
            denial_source: origin.source,
            denial_reason: origin.reason ?? errorMessage,
          }
        : {}),
    })
    .eq("id", batchId);

  return localStatus;
}

/**
 * Reconciles one internal payout batch against PayPal's current view of it.
 *
 * Handles the case that previously went unnoticed: a batch whose header says
 * DENIED but whose item array comes back empty. Before, that produced zero
 * failed items and the batch was recorded as `completed` — silently burying a
 * denial and leaving the earnings stuck. Now a denied header releases every
 * item's earnings regardless of what the item array contains.
 *
 * Side effects: PayPal API read, then item/earning/attempt/batch writes.
 *
 * @param adminClient - Admin Supabase client.
 * @param batch - Internal batch id plus its PayPal batch id.
 * @param origin - Who or what triggered this reconciliation.
 * @returns Counts and statuses describing what changed.
 */
export async function reconcilePayoutBatch(
  adminClient: AnySupabaseClient,
  batch: { id: string; paypalPayoutBatchId: string },
  origin: ReconcileSource
): Promise<ReconcileBatchResult> {
  const paypalStatus = await getPayPalPayoutBatchStatus(batch.paypalPayoutBatchId);

  const batchDenied =
    paypalStatus.batchStatus === "DENIED" ||
    paypalStatus.batchStatus === "CANCELED" ||
    paypalStatus.batchStatus === "CANCELLED";

  // Snapshot the statuses we already had, so a repeat sync can tell a genuine
  // transition apart from re-confirming what was already known.
  const { data: priorRows } = await adminClient
    .from("instructor_payout_items")
    .select("id, status")
    .eq("payout_batch_id", batch.id);

  const priorStatuses = new Map<string, string>(
    ((priorRows ?? []) as { id: string; status: string }[]).map((r) => [r.id, r.status])
  );

  const reportedItemIds = new Set<string>();
  const newlyCompletedItemIds: string[] = [];
  let releasedCount = 0;

  for (const item of paypalStatus.items) {
    reportedItemIds.add(item.senderItemId);

    // A denied batch header overrides a per-item status that still reads PENDING:
    // nothing in a denied batch was paid.
    const status = batchDenied ? "denied" : mapPayPalItemStatus(item.transactionStatus);
    if (releasesEarnings(status)) releasedCount += 1;
    if (status === "completed" && priorStatuses.get(item.senderItemId) !== "completed") {
      newlyCompletedItemIds.push(item.senderItemId);
    }

    await applyItemStatus(adminClient, {
      itemId: item.senderItemId,
      batchId: batch.id,
      status,
      paypalItemId: item.payoutItemId,
      errorMessage: item.errorMessage,
      feeAmount: item.feeAmount,
      timeProcessed: item.timeProcessed,
      origin: batchDenied
        ? {
            ...origin,
            reason:
              origin.reason ??
              `PayPal denied the batch (${paypalStatus.batchStatus}); funds returned.`,
          }
        : origin,
    });
  }

  // PayPal can deny a batch and return no items at all. Release those rows too,
  // or their earnings would stay locked in payout_pending forever.
  if (batchDenied) {
    const { data: unreportedItems } = await adminClient
      .from("instructor_payout_items")
      .select("id")
      .eq("payout_batch_id", batch.id);

    for (const row of (unreportedItems ?? []) as { id: string }[]) {
      if (reportedItemIds.has(row.id)) continue;
      releasedCount += 1;
      await applyItemStatus(adminClient, {
        itemId: row.id,
        batchId: batch.id,
        status: "denied",
        errorMessage: `PayPal denied the batch (${paypalStatus.batchStatus}) without reporting this item.`,
        origin,
      });
    }
  }

  const localBatchStatus = await writeBatchStatus(
    adminClient,
    batch.id,
    paypalStatus.batchStatus,
    paypalStatus.feeTotal,
    origin
  );

  return {
    itemCount: paypalStatus.items.length,
    paypalBatchStatus: paypalStatus.batchStatus,
    localBatchStatus,
    releasedCount,
    newlyCompletedItemIds,
  };
}

/**
 * Records a denial that PayPal has not reported through the API — an admin
 * confirming from the PayPal dashboard or a denial email that funds came back.
 *
 * Marks every item denied and returns all of the batch's earnings to `pending`
 * so they can be resent. Callers MUST verify with PayPal first: if the money
 * was actually delivered, this makes a second payout possible.
 *
 * Side effects: item/earning/attempt/batch writes. Does not call PayPal.
 *
 * @param adminClient - Admin Supabase client.
 * @param batchId - Internal payout batch id to mark denied.
 * @param origin - Who recorded the denial and why.
 * @returns Number of payout items marked denied.
 */
export async function denyPayoutBatchLocally(
  adminClient: AnySupabaseClient,
  batchId: string,
  origin: ReconcileSource
): Promise<number> {
  const { data: itemRows } = await adminClient
    .from("instructor_payout_items")
    .select("id")
    .eq("payout_batch_id", batchId);

  const items = (itemRows ?? []) as { id: string }[];

  for (const item of items) {
    await applyItemStatus(adminClient, {
      itemId: item.id,
      batchId,
      status: "denied",
      errorMessage: origin.reason ?? "Marked denied by super admin.",
      origin,
    });
  }

  const now = new Date().toISOString();
  await adminClient
    .from("instructor_payout_batches")
    .update({
      status: "denied",
      error_message: origin.reason ?? "Marked denied by super admin.",
      completed_at: null,
      denied_at: now,
      denied_by: origin.actorId ?? null,
      denial_source: origin.source,
      denial_reason: origin.reason ?? null,
    })
    .eq("id", batchId);

  return items.length;
}

/**
 * Records a denial for a single instructor's payout item, leaving the rest of
 * the batch untouched.
 *
 * This is the common case when one instructor's PayPal address is wrong while
 * everyone else in the batch was paid normally — denying the whole batch there
 * would re-pay people who already have their money.
 *
 * Side effects: item/earning/attempt writes plus a batch status recompute.
 *
 * @param adminClient - Admin Supabase client.
 * @param params - Item id, its batch id, and the denial origin.
 */
export async function denyPayoutItemLocally(
  adminClient: AnySupabaseClient,
  params: { itemId: string; batchId: string; origin: ReconcileSource }
): Promise<void> {
  await applyItemStatus(adminClient, {
    itemId: params.itemId,
    batchId: params.batchId,
    status: "denied",
    errorMessage: params.origin.reason ?? "Marked denied by super admin.",
    origin: params.origin,
  });

  // Recompute the header from the item rows so a partially denied batch does
  // not keep claiming it completed cleanly.
  await writeBatchStatus(adminClient, params.batchId, "SUCCESS", null, params.origin);
}
