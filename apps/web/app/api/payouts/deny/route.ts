/**
 * POST /api/payouts/deny
 * Called by: Admin payout history panel — "Mark denied" on a batch or a single item
 * Auth: super_admin only
 *
 * Records that PayPal returned the money for a payout the app believed had been
 * sent. PayPal can accept a Payouts batch and deny it hours later — risk review,
 * funding failure, an account limitation — and until that is recorded, the
 * instructor's earnings stay marked as paid out and never get resent.
 *
 * This route is deliberately hard to misuse, because marking a delivered payout
 * as denied lets the same money be sent twice with no way to claw it back:
 *   1. It asks PayPal for the live status first, and REFUSES outright if PayPal
 *      reports the payout succeeded.
 *   2. If PayPal itself reports the denial, it reconciles from PayPal's own data
 *      instead of trusting the admin's assertion.
 *   3. It requires the batch's sender_batch_id to be typed back as confirmation.
 *   4. It records who marked it, when, why, and on what basis.
 *
 * Denying a single item is supported and is usually the right scope: one bad
 * recipient email should not re-pay everyone else in the batch.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { getPayPalPayoutBatchStatus } from "@/lib/paypal-payouts";
import {
  denyPayoutBatchLocally,
  denyPayoutItemLocally,
  mapPayPalItemStatus,
  reconcilePayoutBatch,
} from "@/lib/payout-reconcile";
import type { PayoutDenialSource } from "@/types/payouts";

/** Batch statuses that can be marked denied. */
const DENIABLE_STATUSES = new Set(["assumed_complete", "completed", "needs_review"]);

/** Body accepted by the deny route. */
interface DenyRequestBody {
  batchId?: unknown;
  itemId?: unknown;
  reason?: unknown;
  confirmSenderBatchId?: unknown;
}

/** Batch row loaded before recording a denial. */
interface DenyBatchRow {
  id: string;
  status: string;
  sender_batch_id: string;
  paypal_payout_batch_id: string | null;
}

/** Type guard for deny request bodies. */
function isDenyBody(value: unknown): value is DenyRequestBody {
  return typeof value === "object" && value !== null;
}

/** Reads an optional string field from an unknown body. */
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Records a PayPal payout denial for a whole batch or a single item.
 * Side effects: a live PayPal status read, then payout item/earning/attempt/batch
 * writes. Releases the affected earnings back to `pending` so they can be resent.
 * @param request - JSON body with { batchId, itemId?, reason, confirmSenderBatchId }.
 */
export async function POST(request: Request) {
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const actorId = authResult.actor.user.id;

  const body = await request.json().catch(() => null);
  if (!isDenyBody(body)) {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const batchId = optionalString(body.batchId);
  const itemId = optionalString(body.itemId);
  const reason = optionalString(body.reason);
  const confirmSenderBatchId = optionalString(body.confirmSenderBatchId);

  if (!batchId) {
    return Response.json({ success: false, error: "Missing batchId." }, { status: 400 });
  }
  if (!reason) {
    return Response.json(
      { success: false, error: "A denial reason is required." },
      { status: 400 }
    );
  }

  const adminClient = await createAdminClient();
  const { data: batchRow } = await adminClient
    .from("instructor_payout_batches")
    .select("id, status, sender_batch_id, paypal_payout_batch_id")
    .eq("id", batchId)
    .maybeSingle();

  if (!batchRow) {
    return Response.json({ success: false, error: "Payout batch not found." }, { status: 404 });
  }

  const batch = batchRow as DenyBatchRow;

  if (!DENIABLE_STATUSES.has(batch.status)) {
    const explanation =
      batch.status === "pending"
        ? "This batch was never sent to PayPal. Use Release instead."
        : batch.status === "denied"
          ? "This batch is already marked denied."
          : "This batch already failed and its earnings are back in the payable queue.";
    return Response.json({ success: false, error: explanation }, { status: 400 });
  }

  // Typed confirmation — makes an accidental click impossible, since the wrong
  // call here is the one that can pay an instructor twice.
  if (confirmSenderBatchId !== batch.sender_batch_id) {
    return Response.json(
      {
        success: false,
        error:
          "Confirmation does not match. Type the batch's sender id exactly to confirm you verified in PayPal that the funds were returned.",
      },
      { status: 400 }
    );
  }

  // Verify the item belongs to this batch before touching it.
  if (itemId) {
    const { data: itemRow } = await adminClient
      .from("instructor_payout_items")
      .select("id, status")
      .eq("id", itemId)
      .eq("payout_batch_id", batch.id)
      .maybeSingle();

    if (!itemRow) {
      return Response.json(
        { success: false, error: "Payout item not found in this batch." },
        { status: 404 }
      );
    }
    const item = itemRow as { id: string; status: string };
    if (item.status === "denied") {
      return Response.json(
        { success: false, error: "This payout item is already marked denied." },
        { status: 400 }
      );
    }
  }

  // ── Live PayPal check ────────────────────────────────────────────────────
  // Never take the admin's word over PayPal's when PayPal can be asked.
  let paypalCheckNote = "PayPal status could not be read at the time of denial.";

  if (batch.paypal_payout_batch_id) {
    try {
      const live = await getPayPalPayoutBatchStatus(batch.paypal_payout_batch_id);
      const batchDenied = ["DENIED", "CANCELED", "CANCELLED"].includes(live.batchStatus);

      if (batchDenied) {
        // PayPal agrees, and its data is authoritative — reconcile from it rather
        // than recording a manual assertion.
        const result = await reconcilePayoutBatch(
          adminClient,
          { id: batch.id, paypalPayoutBatchId: batch.paypal_payout_batch_id },
          {
            source: "paypal_sync" as PayoutDenialSource,
            actorId: null,
            reason: `PayPal reports ${live.batchStatus}. ${reason}`,
          }
        );
        return Response.json({
          success: true,
          confirmedByPayPal: true,
          scope: "batch",
          releasedItems: result.releasedCount,
          message: `PayPal confirms this batch was ${live.batchStatus}. ${result.releasedCount} payout item(s) returned to the payable queue.`,
        });
      }

      // Block the denial if PayPal says the money landed.
      if (itemId) {
        const liveItem = live.items.find((entry) => entry.senderItemId === itemId);
        if (liveItem && mapPayPalItemStatus(liveItem.transactionStatus) === "completed") {
          return Response.json(
            {
              success: false,
              error: `PayPal reports this payout succeeded (${liveItem.transactionStatus}). It cannot be marked denied — doing so would allow a second payment for money the instructor already received.`,
            },
            { status: 409 }
          );
        }
      } else if (live.batchStatus === "SUCCESS") {
        const anyCompleted = live.items.some(
          (entry) => mapPayPalItemStatus(entry.transactionStatus) === "completed"
        );
        if (anyCompleted) {
          return Response.json(
            {
              success: false,
              error:
                "PayPal reports payouts in this batch succeeded. Mark only the individual items PayPal returned, rather than the whole batch — denying it entirely would re-pay instructors who already have their money.",
            },
            { status: 409 }
          );
        }
      }

      paypalCheckNote = `PayPal reported batch status ${live.batchStatus} at the time of denial.`;
    } catch (err) {
      // PayPal being unreachable should not permanently block recovery, but the
      // uncertainty is recorded alongside the denial.
      console.error("[payouts/deny] Live PayPal status check failed:", err);
    }
  } else {
    paypalCheckNote = "Batch has no PayPal batch id on record.";
  }

  const origin = {
    source: "manual" as PayoutDenialSource,
    actorId,
    reason: `${reason} (${paypalCheckNote})`,
  };

  if (itemId) {
    await denyPayoutItemLocally(adminClient, { itemId, batchId: batch.id, origin });
    return Response.json({
      success: true,
      confirmedByPayPal: false,
      scope: "item",
      message:
        "Payout item marked denied. Those earnings are back in the payable queue and will go out with the next payout, or you can resend this batch.",
    });
  }

  const deniedCount = await denyPayoutBatchLocally(adminClient, batch.id, origin);

  return Response.json({
    success: true,
    confirmedByPayPal: false,
    scope: "batch",
    releasedItems: deniedCount,
    message: `Batch marked denied. ${deniedCount} payout item(s) returned to the payable queue and can now be resent.`,
  });
}
