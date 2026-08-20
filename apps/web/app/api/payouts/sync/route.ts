/**
 * POST /api/payouts/sync
 * Called by:
 *   - Admin payout history panel — "Sync status" (super_admin session)
 *   - pg_cron job (migration 0048) — hourly reconciliation (CRON_SECRET bearer)
 * Auth: super_admin session OR Authorization: Bearer {CRON_SECRET}
 *
 * Asks PayPal for the current state of every unresolved payout batch and writes
 * the answer back through lib/payout-reconcile.ts, which is also used by the
 * payouts webhook so both paths interpret PayPal identically.
 *
 * The hourly cron matters: PayPal denials usually land minutes to hours after it
 * accepts a batch, and before this job existed the only way to discover one was
 * for an admin to remember to click Sync.
 *
 * A batch whose PayPal lookup errors (network issue, expired credentials, PayPal
 * outage) does not abort the run, but it is counted in `failedBatches` rather
 * than silently dropped — otherwise a total PayPal outage would report the same
 * `success: true, syncedItems: 0` result as "nothing needed checking."
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { reconcilePayoutBatch } from "@/lib/payout-reconcile";
import { notifyInstructorsPaid, notifyPayoutDenied } from "@/lib/payout-notify";
import type { PayoutDenialSource } from "@/types/payouts";
import { isCronRequest, withCronHeartbeat } from "@/lib/cron-heartbeat";

/**
 * Batch statuses worth re-checking against PayPal.
 *
 * `assumed_complete` is the important one — those are batches PayPal accepted
 * but never confirmed, which is exactly where an unnoticed denial hides.
 * `completed` and `denied` are terminal and deliberately excluded.
 */
const SYNCABLE_STATUSES = ["assumed_complete", "failed", "needs_review"];

/** Body accepted by the sync route. */
interface SyncRequestBody {
  batchId?: unknown;
}

/** Batch row shape loaded for reconciliation. */
interface PayoutBatchRow {
  id: string;
  paypal_payout_batch_id: string | null;
}

/** Type guard for sync request bodies. */
function isSyncBody(value: unknown): value is SyncRequestBody {
  return typeof value === "object" && value !== null;
}


/**
 * Syncs either one requested payout batch or every unresolved batch.
 * Side effects: PayPal status reads plus payout item/earning/attempt/batch writes.
 * @param request - Optional JSON body with { batchId }.
 */
async function handlePOST(request: Request) {
  // Cron runs without a session; an admin click must be a super_admin.
  const viaCron = isCronRequest(request);
  let actorId: string | null = null;

  if (!viaCron) {
    const authResult = await requireApiRole(["super_admin"]);
    if ("error" in authResult) return authResult.error;
    actorId = authResult.actor.user.id;
  }

  const body = await request.json().catch(() => null);
  const requestedBatchId =
    isSyncBody(body) && typeof body.batchId === "string" ? body.batchId : null;

  const adminClient = await createAdminClient();
  let query = adminClient
    .from("instructor_payout_batches")
    .select("id, paypal_payout_batch_id")
    .not("paypal_payout_batch_id", "is", null)
    .in("status", SYNCABLE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(20);

  if (requestedBatchId) {
    query = query.eq("id", requestedBatchId);
  }

  const { data: batches, error } = await query;

  if (error) {
    console.error("[payouts/sync] Batch lookup failed:", error);
    return Response.json(
      { success: false, error: "Failed to load payout batches." },
      { status: 500 }
    );
  }

  // A denial found by reconciliation is attributed to paypal_sync, never to the
  // admin who happened to click Sync — the determination came from PayPal.
  const origin = {
    source: "paypal_sync" as PayoutDenialSource,
    actorId: null,
  };

  let syncedItems = 0;
  let deniedBatches = 0;
  let releasedItems = 0;
  let failedBatches = 0;

  for (const batch of (batches ?? []) as PayoutBatchRow[]) {
    if (!batch.paypal_payout_batch_id) continue;
    try {
      const result = await reconcilePayoutBatch(
        adminClient,
        { id: batch.id, paypalPayoutBatchId: batch.paypal_payout_batch_id },
        origin
      );
      syncedItems += result.itemCount;
      releasedItems += result.releasedCount;

      await notifyInstructorsPaid(adminClient, result.newlyCompletedItemIds);

      if (result.localBatchStatus === "denied") {
        deniedBatches += 1;
        await notifyPayoutDenied(adminClient, batch.id, result.paypalBatchStatus);
      }
    } catch (err) {
      // One unreachable batch must not abort the rest of the run, especially on
      // the cron path where nobody is watching for an error response. But the
      // failure still has to be counted — otherwise a PayPal outage looks
      // identical to "nothing needed syncing" to whoever reads the result.
      failedBatches += 1;
      console.error("[payouts/sync] Reconciliation failed for batch", batch.id, err);
    }
  }

  if (deniedBatches > 0) {
    console.warn(
      `[payouts/sync] ${deniedBatches} payout batch(es) were denied by PayPal; ${releasedItems} item(s) re-queued.`
    );
  }

  return Response.json({
    success: true,
    batchCount: batches?.length ?? 0,
    syncedItems,
    deniedBatches,
    releasedItems,
    failedBatches,
    triggeredBy: viaCron ? "cron" : actorId,
  });
}

/**
 * Cron-invoked entry point. The heartbeat wrapper records a cron_run_log row on
 * every outcome so cron_health() can prove this job actually ran — pg_cron's own
 * job_run_details cannot, because net.http_post is fire-and-forget (migration 0057).
 * Manual admin triggers pass straight through unlogged.
 */
export const POST = withCronHeartbeat("reconcile-instructor-payouts", handlePOST);
