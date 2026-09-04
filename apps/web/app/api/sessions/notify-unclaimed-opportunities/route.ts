/**
 * POST /api/sessions/notify-unclaimed-opportunities
 * Called by: pg_cron job "notify-unclaimed-opportunities" (migration 0029)
 * Auth: Authorization: Bearer {CRON_SECRET} only — not manually triggerable by any UI
 *
 * Finds cancelled, still-unassigned sessions starting within 48 hours that
 * haven't been escalated yet, sends one digest email to all super_admins, and
 * marks each session escalated so it isn't re-notified on the next run.
 *
 * This is pure notification — it never changes session status or auto-cancels
 * anything. A super_admin must decide what to do manually.
 *
 * Scheduling note: the target firing times are 12am/9am/12pm/3pm/6pm/9pm
 * *Eastern* time. Vanilla pg_cron (no per-job timezone support in the version
 * installed here) only offers a database-wide `cron.timezone` GUC, which would
 * silently shift the other UTC-authored cron jobs in this database (payouts,
 * daily access codes, social feed) — not worth that risk for one job. Instead
 * the cron job fires at the UTC-equivalent of all 6 Eastern hours under BOTH
 * EST and EDT (12 firings/day — see migration 0029), and isScheduledEasternHour()
 * below no-ops the 6 that don't match the real current Eastern hour. Correct
 * across the DST transition automatically, no cron changes needed twice a year.
 */

import { NextResponse } from "next/server";
import { sendEmail, isEmailConfigured } from "@/lib/send-email";
import { createAdminClient } from "@/lib/supabase/server";
import {
  unclaimedOpportunityEscalationEmail,
  type UnclaimedOpportunitySummary,
} from "@/lib/emails";
import { isCronRequest, withCronHeartbeat } from "@/lib/cron-heartbeat";
import { floatingNow, addFloatingMinutes } from "@/lib/business-time";

/** The Eastern-time hours (0–23) this job should actually run at. */
const TARGET_EASTERN_HOURS = new Set([0, 9, 12, 15, 18, 21]);


/**
 * Whether the current moment falls on one of TARGET_EASTERN_HOURS in
 * America/New_York local time. DST-aware — no manual offset math.
 * @param now - The instant to check.
 */
function isScheduledEasternHour(now: Date): boolean {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  }).format(now);
  const hour = parseInt(hourStr, 10) % 24; // normalize a possible "24" at midnight to 0
  return TARGET_EASTERN_HOURS.has(hour);
}

async function handlePOST(request: Request): Promise<Response> {
  if (!isCronRequest(request)) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  if (!isScheduledEasternHour(new Date())) {
    // Expected no-op: the cron fires 12x/day to cover both DST states,
    // but this job should only actually run at 6 of those 12 firings.
    return NextResponse.json({ data: { notified: 0, skipped: "off-schedule" } });
  }

  const admin = await createAdminClient();
  // Measured from the business wall clock — starts_at is a floating wall-clock
  // value, so a raw Date.now() would shift this window by the UTC offset.
  const fortyEightHoursFromNow = addFloatingMinutes(floatingNow(), 48 * 60);

  const { data: unclaimed, error: queryError } = await admin
    .from("class_sessions")
    .select(
      `
      id, starts_at,
      class_types ( name ),
      locations ( name )
    `
    )
    .eq("status", "cancelled")
    .is("instructor_id", null)
    .is("unclaimed_escalation_sent_at", null)
    .lte("starts_at", fortyEightHoursFromNow);

  if (queryError) {
    console.error("[notify-unclaimed-opportunities] Query failed:", queryError);
    return NextResponse.json({ data: null, error: "Query failed" }, { status: 500 });
  }

  if (!unclaimed || unclaimed.length === 0) {
    return NextResponse.json({ data: { notified: 0 } });
  }

  // Bail before marking sessions escalated — stamping them without sending the
  // digest would suppress the escalation permanently.
  if (!isEmailConfigured()) {
    console.warn("[notify-unclaimed-opportunities] Resend not configured — skipping emails");
    return NextResponse.json({ data: { notified: 0 } });
  }

  const { data: superAdmins } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "super_admin")
    .eq("deactivated", false);

  const superAdminEmails = (superAdmins ?? []).map((p) => p.email).filter(Boolean);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";

  const summaries: UnclaimedOpportunitySummary[] = unclaimed.map((s) => ({
    sessionId: s.id,
    className: (s.class_types as unknown as { name: string } | null)?.name ?? "Unknown Class",
    sessionDate: s.starts_at,
    venueName: (s.locations as unknown as { name: string } | null)?.name ?? "Unknown Location",
  }));

  if (superAdminEmails.length > 0) {
    const digest = unclaimedOpportunityEscalationEmail({ sessions: summaries, baseUrl });
    await sendEmail({
      context: "notify-unclaimed-opportunities:digest",
      to: superAdminEmails,
      subject: digest.subject,
      html: digest.html,
    });
  }

  const { error: markError } = await admin
    .from("class_sessions")
    .update({ unclaimed_escalation_sent_at: new Date().toISOString() })
    .in(
      "id",
      unclaimed.map((s) => s.id)
    );

  if (markError) {
    console.error("[notify-unclaimed-opportunities] Failed to mark sessions escalated:", markError);
  }

  return NextResponse.json({ data: { notified: unclaimed.length } });
}

/**
 * Cron-invoked entry point. The heartbeat wrapper records a cron_run_log row on
 * every outcome so cron_health() can prove this job actually ran — pg_cron's own
 * job_run_details cannot, because net.http_post is fire-and-forget (migration 0057).
 * Manual admin triggers pass straight through unlogged.
 */
export const POST = withCronHeartbeat("notify-unclaimed-opportunities", handlePOST);
