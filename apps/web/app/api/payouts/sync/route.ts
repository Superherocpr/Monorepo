/**
 * POST /api/payouts/sync
 * Called by: Admin Payouts page — "Sync status"
 * Auth: super_admin only
 * Fetches PayPal payout batch status and reconciles payout items + earnings.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getPayPalPayoutBatchStatus } from "@/lib/paypal-payouts";

/** PayPal item statuses that mean the instructor was paid successfully. */
const SUCCESS_STATUSES = new Set(["SUCCESS"]);

/** PayPal item statuses that should release earnings for another payout attempt. */
const FAILED_STATUSES = new Set([
  "FAILED",
  "RETURNED",
  "BLOCKED",
  "REFUNDED",
  "REVERSED",
  "DENIED",
]);

/** Body accepted by the sync route. */
interface SyncRequestBody {
  batchId?: unknown;
}

/** Batch row shape loaded for reconciliation. */
interface PayoutBatchRow {
  id: string;
  paypal_payout_batch_id: string | null;
}

/**
 * Returns the current super admin's profile id or a Response when unauthorized.
 * @returns Profile id for authorized super admins, otherwise an HTTP Response.
 */
async function requireSuperAdmin(): Promise<string | Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, archived, deactivated")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.role !== "super_admin" ||
    profile.archived ||
    profile.deactivated
  ) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  return profile.id as string;
}

/** Type guard for sync request bodies. */
function isSyncBody(value: unknown): value is SyncRequestBody {
  return typeof value === "object" && value !== null;
}

/** Maps PayPal item status to the local payout item status enum. */
function localItemStatus(payPalStatus: string): "submitted" | "completed" | "failed" {
  if (SUCCESS_STATUSES.has(payPalStatus)) return "completed";
  if (FAILED_STATUSES.has(payPalStatus)) return "failed";
  return "submitted";
}

/**
 * Reconciles one internal payout batch against PayPal status.
 * Side effects: updates payout item statuses, earning statuses, and batch status.
 * @param batch - Internal payout batch row with PayPal batch id.
 * @returns Number of payout items reconciled.
 */
async function syncBatch(batch: PayoutBatchRow): Promise<number> {
  if (!batch.paypal_payout_batch_id) return 0;

  const adminClient = await createAdminClient();
  const paypalStatus = await getPayPalPayoutBatchStatus(batch.paypal_payout_batch_id);
  const now = new Date().toISOString();
  let failedCount = 0;

  for (const item of paypalStatus.items) {
    const mappedStatus = localItemStatus(item.transactionStatus);
    if (mappedStatus === "failed") failedCount += 1;

    await adminClient
      .from("instructor_payout_items")
      .update({
        status: mappedStatus,
        paypal_payout_item_id: item.payoutItemId,
        error_message: item.errorMessage,
        updated_at: now,
      })
      .eq("id", item.senderItemId)
      .eq("payout_batch_id", batch.id);

    if (mappedStatus === "completed") {
      await adminClient
        .from("instructor_earnings")
        .update({ status: "paid", updated_at: now })
        .eq("payout_item_id", item.senderItemId)
        .eq("status", "payout_pending");
    }

    if (mappedStatus === "failed") {
      await adminClient
        .from("instructor_earnings")
        .update({
          status: "pending",
          payout_batch_id: null,
          payout_item_id: null,
          updated_at: now,
        })
        .eq("payout_item_id", item.senderItemId)
        .eq("status", "payout_pending");
    }
  }

  const paypalBatchDone = ["SUCCESS", "DENIED", "CANCELED"].includes(
    paypalStatus.batchStatus
  );
  const localBatchStatus =
    paypalBatchDone && failedCount === 0 ? "completed" : failedCount > 0 ? "failed" : "submitted";

  await adminClient
    .from("instructor_payout_batches")
    .update({
      status: localBatchStatus,
      error_message: failedCount > 0 ? "One or more payout items failed." : null,
      completed_at: localBatchStatus === "completed" ? now : null,
    })
    .eq("id", batch.id);

  return paypalStatus.items.length;
}

/**
 * Syncs either one requested payout batch or all submitted batches.
 * Side effects: PayPal status fetches and local reconciliation updates.
 * @param request - Optional JSON body with { batchId }.
 */
export async function POST(request: Request) {
  const actorId = await requireSuperAdmin();
  if (actorId instanceof Response) return actorId;

  const body = await request.json().catch(() => null);
  const requestedBatchId = isSyncBody(body) && typeof body.batchId === "string"
    ? body.batchId
    : null;

  const adminClient = await createAdminClient();
  let query = adminClient
    .from("instructor_payout_batches")
    .select("id, paypal_payout_batch_id")
    .not("paypal_payout_batch_id", "is", null)
    .in("status", ["submitted", "failed"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (requestedBatchId) {
    query = query.eq("id", requestedBatchId);
  }

  const { data: batches, error } = await query;

  if (error) {
    console.error("[payouts/sync] Batch lookup failed:", error);
    return Response.json({ success: false, error: "Failed to load payout batches." }, { status: 500 });
  }

  let syncedItems = 0;
  for (const batch of (batches ?? []) as PayoutBatchRow[]) {
    syncedItems += await syncBatch(batch);
  }

  return Response.json({
    success: true,
    batchCount: batches?.length ?? 0,
    syncedItems,
  });
}
