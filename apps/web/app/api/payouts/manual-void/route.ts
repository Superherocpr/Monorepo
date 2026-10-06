/**
 * POST /api/payouts/manual-void
 * Called by: Admin payout history panel, "Undo" on an item recorded as paid manually
 * Auth: super_admin only
 *
 * Reverses a manual settlement recorded by mistake (for example, it was marked
 * paid before the payment was actually sent). The earnings go back to `pending`
 * and the item returns to the denied/failed state it had, so it can be settled
 * again or sent through PayPal. A reason is required and is stored with who undid
 * it. The instructor is not emailed about an undo; tell them directly.
 *
 * The write is one atomic RPC (void_manual_payout_item, migration 0074).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import {
  describeManualRpcFailure,
  isManualRpcResult,
  parseManualVoidBody,
} from "@/lib/payout-manual";

/**
 * Undoes one manual payout settlement.
 * Side effects: the void RPC (item, earnings, attempt and batch writes).
 * @param request - JSON body with { itemId, reason }.
 */
export async function POST(request: Request) {
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const actorId = authResult.actor.user.id;

  const parsed = parseManualVoidBody(await request.json().catch(() => null));
  if (!parsed.ok) {
    return Response.json({ success: false, error: parsed.error }, { status: 400 });
  }

  const adminClient = await createAdminClient();
  const { data: rpcData, error: rpcError } = await adminClient.rpc("void_manual_payout_item", {
    p_actor_id: actorId,
    p_item_id: parsed.value.itemId,
    p_reason: parsed.value.reason,
  });

  if (rpcError) {
    console.error("[payouts/manual-void] RPC failed:", rpcError);
    return Response.json(
      { success: false, error: "Failed to undo the manual payment." },
      { status: 500 }
    );
  }

  if (!isManualRpcResult(rpcData)) {
    console.error("[payouts/manual-void] Unexpected RPC result:", rpcData);
    return Response.json(
      { success: false, error: "Failed to undo the manual payment." },
      { status: 500 }
    );
  }

  if (!rpcData.success) {
    const failure = describeManualRpcFailure(rpcData);
    return Response.json({ success: false, error: failure.error }, { status: failure.status });
  }

  return Response.json({
    success: true,
    message:
      "Manual payment undone. Those earnings are back in the payable queue, and the payout can be recorded again or resent.",
  });
}
