/**
 * POST /api/certifications/send-reminders
 * Called by:
 *   - pg_cron job (migration 0051) — daily at 13:00 UTC (CRON_SECRET bearer)
 *   - CertificationsClient — "Send Reminders to All" button (super_admin session)
 * Auth: super_admin session OR Authorization: Bearer {CRON_SECRET}
 * Sends expiry reminder emails via Resend to every customer whose cert has
 * reached one of the 90/60/30/7-day-before-expiry milestones and hasn't been
 * emailed for that milestone yet. Stamps last_reminder_sent_days so the same
 * milestone isn't re-sent on a later run.
 * Blocked when the system_settings key cert_reminders_paused is "true".
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { sendEmail, isEmailConfigured } from "@/lib/send-email";
import { certReminderEmail } from "@/lib/emails";
import { isCronRequest, withCronHeartbeat } from "@/lib/cron-heartbeat";

/** Reminder milestones, in days-before-expiry, nearest-to-expiry first. */
const MILESTONES_ASC = [7, 30, 60, 90] as const;


/**
 * Returns the milestone (90/60/30/7) a cert has currently reached — the
 * smallest configured milestone still >= daysRemaining — or null if it
 * hasn't reached the 90-day-out mark yet.
 * @param daysRemaining - Days until the certification expires.
 */
function currentMilestone(daysRemaining: number): (typeof MILESTONES_ASC)[number] | null {
  for (const milestone of MILESTONES_ASC) {
    if (daysRemaining <= milestone) return milestone;
  }
  return null;
}

/**
 * Sends batch cert expiry reminders to every customer due for their next
 * 90/60/30/7-day milestone email.
 * Side effects: reads certifications, sends one email per due cert via
 * Resend, writes last_reminder_sent_days on each cert emailed.
 * @param request - No body required; cron calls carry a CRON_SECRET bearer
 *   token instead of a session.
 */
async function handlePOST(request: Request) {

  // ── Auth & role check ──────────────────────────────────────────────────────
  const viaCron = isCronRequest(request);
  let actorId: string | null = null;

  if (!viaCron) {
    const authResult = await requireApiRole(["super_admin"]);
    if ("error" in authResult) return authResult.error;
    actorId = authResult.actor.user.id;
  }

  // ── Check whether reminders are paused ────────────────────────────────────
  // Always verify at the API layer even though the client button is disabled
  // when paused — prevents any race condition or direct API call bypass.
  const adminSupabase = await createAdminClient();
  const { data: setting } = await adminSupabase
    .from("system_settings")
    .select("value")
    .eq("key", "cert_reminders_paused")
    .maybeSingle();

  if (setting?.value === "true") {
    return Response.json(
      { success: false, error: "Reminders are currently paused." },
      { status: 403 }
    );
  }

  // ── Fetch certs within the widest milestone window ─────────────────────────
  const now = new Date();
  const widestMilestone = MILESTONES_ASC[MILESTONES_ASC.length - 1];
  const windowEnd = new Date(now.getTime() + widestMilestone * 24 * 60 * 60 * 1000);

  const { data: certs, error: certsError } = await adminSupabase
    .from("certifications")
    .select(`
      id, expires_at, last_reminder_sent_days,
      profiles!customer_id ( first_name, email ),
      cert_types ( name )
    `)
    .gte("expires_at", now.toISOString().split("T")[0])
    .lte("expires_at", windowEnd.toISOString().split("T")[0]);

  if (certsError) {
    console.error("[POST /api/certifications/send-reminders] Fetch error", certsError);
    return Response.json({ error: "Failed to fetch certifications." }, { status: 500 });
  }

  if (!certs?.length) {
    return Response.json({ success: true, count: 0, triggeredBy: viaCron ? "cron" : actorId });
  }

  // Fail loudly rather than reporting a successful run that sent nothing. Without
  // this, a missing Resend variable returned `count: 0` — indistinguishable from
  // "no certs were due" — and the cron heartbeat recorded a healthy run forever.
  if (!isEmailConfigured()) {
    console.error(
      "[POST /api/certifications/send-reminders] Resend is not configured — no reminders can be sent."
    );
    return Response.json({ error: "Email is not configured." }, { status: 500 });
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const cert of certs) {
    const daysRemaining = Math.ceil(
      (new Date(cert.expires_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    const milestone = currentMilestone(daysRemaining);
    if (milestone === null) continue;

    // Already emailed for this milestone or a closer one — skip.
    const lastSent = cert.last_reminder_sent_days as number | null;
    if (lastSent !== null && lastSent <= milestone) continue;

    // Type narrowing: the joined profiles/cert_types may be arrays or single objects
    // depending on how Supabase returns the join. Guard for both shapes.
    const profileData = Array.isArray(cert.profiles) ? cert.profiles[0] : cert.profiles;
    const certTypeData = Array.isArray(cert.cert_types) ? cert.cert_types[0] : cert.cert_types;

    if (!profileData?.email || !certTypeData?.name) continue;

    const { subject, html } = certReminderEmail({
      firstName: profileData.first_name,
      certName: certTypeData.name,
      daysRemaining,
    });

    // Keyed on cert + milestone so a cron retry of this whole run cannot email
    // the same customer about the same milestone twice.
    const result = await sendEmail({
      context: "certifications/send-reminders",
      to: profileData.email,
      subject,
      html,
      idempotencyKey: `cert-reminder-${cert.id}-${milestone}`,
    });

    // Only stamp the milestone when the mail actually went out. Stamping on a
    // failed send would permanently suppress this customer's reminder for this
    // milestone — the next run would skip them as "already reminded".
    if (!result.sent) {
      failedCount++;
      continue;
    }

    // Stamp the milestone reached (not just "reminded") so the next run
    // can tell whether this cert still owes an email for a closer stage.
    await adminSupabase
      .from("certifications")
      .update({ last_reminder_sent_days: milestone })
      .eq("id", cert.id);

    sentCount++;
  }

  return Response.json({
    success: true,
    count: sentCount,
    failed: failedCount,
    triggeredBy: viaCron ? "cron" : actorId,
  });
}

/**
 * Cron-invoked entry point. The heartbeat wrapper records a cron_run_log row on
 * every outcome so cron_health() can prove this job actually ran — pg_cron's own
 * job_run_details cannot, because net.http_post is fire-and-forget (migration 0057).
 * Manual admin triggers pass straight through unlogged.
 */
export const POST = withCronHeartbeat("cert-expiry-reminders", handlePOST);
