/**
 * POST /api/payouts/retry
 * Called by: Admin payout history panel — "Resend" on a denied or failed batch
 * Auth: super_admin only
 *
 * Builds a NEW payout batch from exactly the earnings of a denied/failed batch
 * and submits it to PayPal. The new batch links back to the original via
 * retry_of_batch_id and carries a fresh sender_batch_id — PayPal rejects a
 * reused sender_batch_id as a duplicate, so a retry can never be a re-send of
 * the same identifier.
 *
 * The reservation RPC refuses a partial retry: if any of the source earnings
 * have already been paid, swept into a newer batch, or become unpayable, it
 * returns a reason instead of sending, because resending the batch as-is could
 * double-pay. Nothing is stranded by that refusal — earnings released by a
 * denial are back to `pending` and the normal "Send Payouts" flow collects them.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { submitReservedPayout } from "@/lib/payout-submit";
import type { ReservedPayoutResult } from "@/types/payouts";

/** Body accepted by the retry route. */
interface RetryRequestBody {
  batchId?: unknown;
}

/** Type guard for retry request bodies. */
function isRetryBody(value: unknown): value is RetryRequestBody {
  return typeof value === "object" && value !== null;
}

/**
 * Turns a reservation refusal into an admin-readable explanation.
 * @param reservation - Failed result from reserve_payout_retry_batch.
 * @returns A sentence explaining why the retry did not run.
 */
function explainRefusal(reservation: ReservedPayoutResult | null): string {
  switch (reservation?.reason) {
    case "source_batch_not_found":
      return "That payout batch no longer exists.";
    case "source_batch_not_retryable":
      return reservation.status === "needs_review"
        ? "This batch needs review first. Its PayPal outcome is unknown, so resending could pay instructors twice — confirm in PayPal, then mark it denied if the funds were returned."
        : `Only denied or failed batches can be resent. This one is "${reservation.status ?? "unknown"}".`;
    case "no_attempt_history":
      return "This batch predates payout attempt tracking, so its earnings cannot be identified for a targeted resend. Use \"Send Payouts\" to pay whatever is currently pending.";
    case "earnings_changed": {
      const moved = reservation.moved ?? 0;
      const blocked = reservation.blocked ?? 0;
      const parts: string[] = [];
      if (moved > 0) parts.push(`${moved} already moved into another payout`);
      if (blocked > 0) parts.push(`${blocked} no longer payable (missing payout email or inactive instructor)`);
      return `Cannot resend this batch exactly as it was: ${parts.join(" and ")}. Use "Send Payouts" instead to pay what is currently owed.`;
    }
    case "earnings_locked":
      return "Another payout is processing these earnings right now. Wait for it to finish, then try again.";
    case "no_retryable_earnings":
      return "None of this batch's earnings are still awaiting payment.";
    default:
      return "Could not reserve this batch for a resend.";
  }
}

/**
 * Resends a denied or failed payout batch as a new linked batch.
 * Side effects: DB reservation, PayPal Payouts API call (moves real money),
 * and batch/item/attempt status writes.
 * @param request - JSON body containing { batchId }.
 */
export async function POST(request: Request) {
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const actorId = authResult.actor.user.id;

  const body = await request.json().catch(() => null);
  const batchId =
    isRetryBody(body) && typeof body.batchId === "string" ? body.batchId : null;

  if (!batchId) {
    return Response.json({ success: false, error: "Missing batchId." }, { status: 400 });
  }

  const adminClient = await createAdminClient();
  const { data, error } = await adminClient.rpc("reserve_payout_retry_batch", {
    p_actor_id: actorId,
    p_source_batch_id: batchId,
  });

  if (error) {
    if (error.message?.includes("forbidden")) {
      return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    console.error("[payouts/retry] Retry reservation failed:", error);
    return Response.json(
      { success: false, error: "Failed to reserve the retry batch." },
      { status: 500 }
    );
  }

  const reservation = data as ReservedPayoutResult | null;
  if (!reservation?.success || !reservation.batch || !reservation.items?.length) {
    return Response.json(
      { success: false, error: explainRefusal(reservation) },
      { status: 400 }
    );
  }

  const result = await submitReservedPayout(adminClient, reservation);

  if (!result.success) {
    return Response.json(
      { success: false, error: result.error },
      { status: result.httpStatus }
    );
  }

  return Response.json({
    success: true,
    batchId: result.batchId,
    paypalBatchId: result.paypalBatchId,
    totalAmount: result.totalAmount,
    itemCount: result.itemCount,
    retryOfBatchId: batchId,
  });
}
