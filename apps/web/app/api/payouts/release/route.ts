/**
 * POST /api/payouts/release
 * Called by: Admin Payouts page — failed batch recovery action
 * Auth: super_admin only
 * Releases a failed payout reservation with no confirmed PayPal batch id after
 * the admin has verified in PayPal that no payout was created.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

/** Body accepted by the release route. */
interface ReleaseRequestBody {
  batchId?: unknown;
}

/** Internal payout batch fields needed before release. */
interface ReleaseBatchRow {
  id: string;
  status: string;
  paypal_payout_batch_id: string | null;
}

/**
 * Returns the current super admin's profile id or a Response when unauthorized.
 * @returns Profile id for authorized super admins, otherwise an HTTP Response.
 */
async function requireSuperAdmin(): Promise<string | Response> {
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  return actor.user.id;
}

/** Type guard for release request bodies. */
function isReleaseBody(value: unknown): value is ReleaseRequestBody {
  return typeof value === "object" && value !== null;
}

/**
 * Releases a failed, unsubmitted payout reservation back to pending earnings.
 * Side effects: clears earning payout links and annotates the failed batch/items.
 * @param batchId - Internal payout batch id to release.
 */
async function releaseBatch(batchId: string): Promise<void> {
  const adminClient = await createAdminClient();
  const now = new Date().toISOString();

  await adminClient
    .from("instructor_earnings")
    .update({
      status: "pending",
      payout_batch_id: null,
      payout_item_id: null,
      updated_at: now,
    })
    .eq("payout_batch_id", batchId)
    .eq("status", "payout_pending");

  await adminClient
    .from("instructor_payout_items")
    .update({
      status: "failed",
      error_message: "Released by super admin after PayPal review.",
      updated_at: now,
    })
    .eq("payout_batch_id", batchId);

  await adminClient
    .from("instructor_payout_batches")
    .update({
      status: "failed",
      error_message: "Released by super admin after PayPal review.",
    })
    .eq("id", batchId);
}

/**
 * Releases a failed payout batch with no PayPal batch id back to pending earnings.
 * Side effects: database updates only; does not call PayPal.
 * @param request - JSON body containing { batchId }.
 */
export async function POST(request: Request) {
  const actorId = await requireSuperAdmin();
  if (actorId instanceof Response) return actorId;

  const body = await request.json().catch(() => null);
  const batchId = isReleaseBody(body) && typeof body.batchId === "string"
    ? body.batchId
    : null;

  if (!batchId) {
    return Response.json({ success: false, error: "Missing batchId." }, { status: 400 });
  }

  const adminClient = await createAdminClient();
  const { data: batch, error } = await adminClient
    .from("instructor_payout_batches")
    .select("id, status, paypal_payout_batch_id")
    .eq("id", batchId)
    .single();

  if (error || !batch) {
    return Response.json({ success: false, error: "Payout batch not found." }, { status: 404 });
  }

  const payoutBatch = batch as ReleaseBatchRow;
  if (payoutBatch.status !== "failed" || payoutBatch.paypal_payout_batch_id) {
    return Response.json(
      {
        success: false,
        error: "Only failed batches with no PayPal batch id can be released.",
      },
      { status: 400 }
    );
  }

  await releaseBatch(payoutBatch.id);

  return Response.json({ success: true, batchId: payoutBatch.id });
}