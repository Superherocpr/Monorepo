/**
 * POST /api/payouts/manual-settle
 * Called by: Admin payout history panel, "Paid manually" on a denied or failed payout item
 * Auth: super_admin only
 *
 * Records that an instructor was paid outside PayPal (Zelle, check, ...) for a
 * payout item PayPal denied or that failed to send. The earnings behind the item
 * become `paid`, so the next "Send Payouts" run cannot pay them a second time.
 *
 * This route is deliberately hard to misuse, because a wrong call here either
 * double-pays an instructor or marks unpaid money as paid:
 *   1. The item must be denied or failed. Items still moving at PayPal (in flight,
 *      unclaimed) are refused, since PayPal could still deliver them.
 *   2. PayPal is asked for the live status first and the request is refused if
 *      PayPal reports the item succeeded or is still in flight.
 *   3. The batch's sender_batch_id must be typed back as confirmation.
 *   4. The amount must equal what is owed, and a method, reference and date are
 *      required, so there is always a trail of who paid what, how, and when.
 *   5. The write is one atomic RPC (record_manual_payout_item, migration 0075).
 *
 * The instructor is emailed once the record is saved (best effort).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { getPayPalPayoutBatchStatus } from "@/lib/paypal-payouts";
import { mapPayPalItemStatus } from "@/lib/payout-reconcile";
import { notifyInstructorManualPayout } from "@/lib/payout-notify";
import {
  describeManualRpcFailure,
  isManualRpcResult,
  parseManualSettleBody,
} from "@/lib/payout-manual";

/** Batch row loaded before settling. */
interface SettleBatchRow {
  id: string;
  sender_batch_id: string;
  paypal_payout_batch_id: string | null;
}

/**
 * Records a manual payment for one payout item.
 * Side effects: a live PayPal status read, the settle RPC (item, earnings,
 * attempt and batch writes), and one instructor email via Resend.
 * @param request - JSON body with { batchId, itemId, method, reference, paidOn, amount, note?, confirmSenderBatchId }.
 */
export async function POST(request: Request) {
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const actorId = authResult.actor.user.id;

  const parsed = parseManualSettleBody(await request.json().catch(() => null));
  if (!parsed.ok) {
    return Response.json({ success: false, error: parsed.error }, { status: 400 });
  }
  const input = parsed.value;

  const adminClient = await createAdminClient();
  const { data: batchRow } = await adminClient
    .from("instructor_payout_batches")
    .select("id, sender_batch_id, paypal_payout_batch_id")
    .eq("id", input.batchId)
    .maybeSingle();

  if (!batchRow) {
    return Response.json({ success: false, error: "Payout batch not found." }, { status: 404 });
  }
  const batch = batchRow as SettleBatchRow;

  // Typed confirmation, so a stray click cannot record money as paid.
  if (input.confirmSenderBatchId !== batch.sender_batch_id) {
    return Response.json(
      {
        success: false,
        error:
          "Confirmation does not match. Type the batch's sender id exactly to confirm the instructor was paid.",
      },
      { status: 400 }
    );
  }

  // ── Live PayPal check ────────────────────────────────────────────────────
  // If PayPal says the money landed or is still moving, a manual payment on top
  // of it is a double payment. The local status is already denied/failed (the RPC
  // re-checks it), so an unreachable PayPal does not block recovery.
  if (batch.paypal_payout_batch_id) {
    try {
      const live = await getPayPalPayoutBatchStatus(batch.paypal_payout_batch_id);
      const liveItem = live.items.find((entry) => entry.senderItemId === input.itemId);
      if (liveItem) {
        const liveStatus = mapPayPalItemStatus(liveItem.transactionStatus);
        if (liveStatus === "completed") {
          return Response.json(
            {
              success: false,
              error: `PayPal reports this payout succeeded (${liveItem.transactionStatus}). Run Sync status instead; recording a manual payment would pay the instructor twice.`,
            },
            { status: 409 }
          );
        }
        if (liveStatus === "assumed_complete" || liveStatus === "unclaimed") {
          return Response.json(
            {
              success: false,
              error: `PayPal still shows this payout as ${liveItem.transactionStatus}, so it may yet be delivered. Wait until PayPal returns or denies it before paying manually.`,
            },
            { status: 409 }
          );
        }
      }
    } catch (err) {
      console.error("[payouts/manual-settle] Live PayPal status check failed:", err);
    }
  }

  const { data: rpcData, error: rpcError } = await adminClient.rpc("record_manual_payout_item", {
    p_actor_id: actorId,
    p_batch_id: input.batchId,
    p_item_id: input.itemId,
    p_method: input.method,
    p_reference: input.reference,
    p_paid_on: input.paidOn,
    p_amount: input.amount,
    p_note: input.note,
  });

  if (rpcError) {
    console.error("[payouts/manual-settle] RPC failed:", rpcError);
    return Response.json(
      { success: false, error: "Failed to record the manual payment." },
      { status: 500 }
    );
  }

  if (!isManualRpcResult(rpcData)) {
    console.error("[payouts/manual-settle] Unexpected RPC result:", rpcData);
    return Response.json(
      { success: false, error: "Failed to record the manual payment." },
      { status: 500 }
    );
  }

  if (!rpcData.success) {
    const failure = describeManualRpcFailure(rpcData);
    return Response.json({ success: false, error: failure.error }, { status: failure.status });
  }

  await notifyInstructorManualPayout(adminClient, input.itemId);

  return Response.json({
    success: true,
    message:
      "Recorded as paid manually. Those earnings are now marked paid and will not go out again.",
  });
}
