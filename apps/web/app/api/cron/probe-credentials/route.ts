/**
 * POST /api/cron/probe-credentials
 * Called by: the weekly `probe-credentials` pg_cron job, and the admin settings
 *            page as a manual "check credentials now" trigger.
 * Auth: super_admin session OR Authorization: Bearer {CRON_SECRET}
 *
 * Calls every third-party credential the app depends on with a cheap read and
 * reports which are dead, degraded, or expiring. Emails super admins when
 * something needs attention; stays silent when everything is healthy.
 *
 * WHY A NON-2XX ON FAILURE MATTERS
 *   Returning 502 when a credential is dead makes withCronHeartbeat record
 *   ok=false. Because cron_health() measures the gap since the last *successful*
 *   run, a credential that stays broken eventually surfaces the job as overdue in
 *   the daily digest — so the problem escalates on its own even if the alert
 *   email is missed or filtered. A 200-with-warnings would be silently forgotten,
 *   which is the exact failure mode this endpoint exists to eliminate.
 *
 * Returns:
 *   200 { healthy: true, probesRun, checked }        — everything passed
 *   502 { healthy: false, probesRun, actionable[] }  — at least one needs attention
 *   401 { error: "Unauthorized" }                    — no admin session, no valid cron secret
 */

import { NextResponse } from "next/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import { getSetting } from "@/lib/zoho";
import { withCronHeartbeat } from "@/lib/cron-heartbeat";
import { runCredentialProbes, summarizeProbes } from "@/lib/credential-probes";
import { notifyCredentialProblems } from "@/lib/credential-notify";

/**
 * Verifies the caller is either the cron service or an authenticated super_admin.
 * Dual-auth mirrors the other cron routes: the scheduler cannot hold a session,
 * and an admin needs to be able to re-check on demand after fixing something.
 * @param req - Incoming request.
 * @returns true when the caller is authorized.
 */
async function isAuthorized(req: Request): Promise<boolean> {
  // Cron path first — avoids a DB round trip for scheduled invocations.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  try {
    const actor = await getAdminActor();
    return actor?.effectiveRole === "super_admin";
  } catch {
    return false;
  }
}

async function handlePOST(req: Request): Promise<NextResponse> {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The Zoho refresh token lives in system_settings, not the environment. A read
  // failure yields null, which the probe reports as "not connected" rather than
  // silently skipping — an unreadable credential is an unknown, not a pass.
  let zohoRefreshToken: string | null = null;
  try {
    zohoRefreshToken = await getSetting("zoho_refresh_token");
  } catch (err) {
    console.error("[probe-credentials] could not read zoho_refresh_token:", err);
  }

  const probes = await runCredentialProbes({ zohoRefreshToken });
  const summary = summarizeProbes(probes);

  // One line per probe so the outcome is greppable in CloudWatch without opening
  // an inbox — the same reasoning as the health-invariant console.error.
  for (const probe of probes) {
    const line = `[probe-credentials] ${probe.name}: ${probe.status} — ${probe.detail}`;
    if (probe.status === "dead" || probe.status === "probe_failed") {
      console.error(line);
    } else if (probe.status === "degraded") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  if (summary.healthy) {
    return NextResponse.json({
      healthy: true,
      probesRun: summary.probesRun,
      checked: probes.map((p) => p.name),
    });
  }

  // Non-fatal: a failed alert email must not mask the probe result itself.
  await notifyCredentialProblems(summary);

  return NextResponse.json(
    {
      healthy: false,
      probesRun: summary.probesRun,
      deadCount: summary.dead.length,
      degradedCount: summary.degraded.length,
      expiringSoonCount: summary.expiringSoon.length,
      probeFailedCount: summary.failed.length,
      actionable: summary.actionable.map((p) => ({
        name: p.name,
        status: p.status,
        detail: p.detail,
        daysUntilExpiry: p.daysUntilExpiry,
      })),
    },
    { status: 502 }
  );
}

/**
 * Cron-invoked entry point. The heartbeat wrapper records a cron_run_log row on
 * every outcome so cron_health() can prove this job ran — pg_cron's own
 * job_run_details cannot, because net.http_post is fire-and-forget (migration 0057).
 * Manual admin triggers pass straight through unlogged, so clicking the button
 * cannot disguise a dead schedule.
 */
export const POST = withCronHeartbeat("probe-credentials", handlePOST);
