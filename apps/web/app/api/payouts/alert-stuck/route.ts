/**
 * POST /api/payouts/alert-stuck
 * Called by:
 *   - pg_cron job (migration 0050) — daily at 14:00 UTC (CRON_SECRET bearer)
 *   - Super admin, for manual testing (super_admin session)
 * Auth: super_admin session OR Authorization: Bearer {CRON_SECRET}
 *
 * Finds payout batches sitting in needs_review, denied, or failed that haven't
 * been alerted on in the last 18 hours, emails all super_admins a digest via
 * lib/payout-notify.ts, and stamps admin_alert_sent_at so the same batch isn't
 * re-emailed on tomorrow's run if it's already been actioned. Pure notification
 * — it never changes batch state itself.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { notifyPayoutIssuesDigest } from "@/lib/payout-notify";
import { withCronHeartbeat } from "@/lib/cron-heartbeat";

/** Batches older than this since their last alert are re-alerted. */
const RE_ALERT_AFTER_HOURS = 18;

/** Statuses considered unresolved and worth alerting on. */
const STUCK_STATUSES = ["needs_review", "denied", "failed"];

/**
 * Verifies an Authorization: Bearer {CRON_SECRET} header on the request.
 * @param request - Incoming HTTP request.
 * @returns true when the header is valid, false otherwise.
 */
function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

/**
 * Sweeps for unresolved payout batches and emails super_admins a digest.
 * Side effects: reads instructor_payout_batches, sends one digest email,
 * writes admin_alert_sent_at on every batch included in the digest.
 * @param request - No body required.
 */
async function handlePOST(request: Request) {
  const viaCron = isCronRequest(request);
  let actorId: string | null = null;

  if (!viaCron) {
    const authResult = await requireApiRole(["super_admin"]);
    if ("error" in authResult) return authResult.error;
    actorId = authResult.actor.user.id;
  }

  const adminClient = await createAdminClient();
  const cutoff = new Date(Date.now() - RE_ALERT_AFTER_HOURS * 60 * 60 * 1000).toISOString();

  const { data: batches, error } = await adminClient
    .from("instructor_payout_batches")
    .select("id")
    .in("status", STUCK_STATUSES)
    .or(`admin_alert_sent_at.is.null,admin_alert_sent_at.lt.${cutoff}`);

  if (error) {
    console.error("[payouts/alert-stuck] Batch lookup failed:", error);
    return Response.json(
      { success: false, error: "Failed to load payout batches." },
      { status: 500 }
    );
  }

  const batchIds = (batches ?? []).map((batch) => batch.id as string);

  if (batchIds.length === 0) {
    return Response.json({ success: true, alerted: 0, triggeredBy: viaCron ? "cron" : actorId });
  }

  await notifyPayoutIssuesDigest(adminClient, batchIds);

  const { error: stampError } = await adminClient
    .from("instructor_payout_batches")
    .update({ admin_alert_sent_at: new Date().toISOString() })
    .in("id", batchIds);

  if (stampError) {
    // The email already went out; failing to stamp only risks a duplicate
    // alert tomorrow, not a missed one, so this is logged rather than thrown.
    console.error("[payouts/alert-stuck] Failed to stamp admin_alert_sent_at:", stampError);
  }

  return Response.json({
    success: true,
    alerted: batchIds.length,
    triggeredBy: viaCron ? "cron" : actorId,
  });
}

/**
 * Cron-invoked entry point. The heartbeat wrapper records a cron_run_log row on
 * every outcome so cron_health() can prove this job actually ran — pg_cron's own
 * job_run_details cannot, because net.http_post is fire-and-forget (migration 0057).
 * Manual admin triggers pass straight through unlogged.
 */
export const POST = withCronHeartbeat("alert-stuck-payout-batches", handlePOST);
