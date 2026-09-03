/**
 * Credential-probe alert email.
 *
 * Called by POST /api/cron/probe-credentials when at least one third-party
 * credential is dead, degraded, expiring, or unprobeable. Best-effort in the same
 * way as payout-notify: a mail failure is logged and swallowed, never allowed to
 * change the probe's own result.
 *
 * Deliberately silent when everything is healthy. A weekly "all good" email is
 * trained-to-ignore within a month, and this alert needs to still mean something
 * the one time it fires.
 *
 * Server-side only; never import from a client component.
 */

import { sendEmail, isEmailConfigured } from "@/lib/send-email";
import { createAdminClient } from "@/lib/supabase/server";
import { escapeHtml } from "@/lib/emails";
import type { CredentialProbe, ProbeSummary } from "@/lib/credential-probes";

/** Returns the configured app base URL for links inside emails. */
function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
}

/** The only host that may send credential alerts. */
const PRODUCTION_HOST = "superherocpr.com";

/**
 * Whether this deployment is production.
 *
 * Migration 0058 schedules probe-credentials on BOTH environments, deliberately —
 * environment parity means a future migration replay cannot make them diverge.
 * But staging inherits almost every credential from the app-level Amplify config,
 * so its probe reaches the same verdict as production, and `profiles` on staging
 * holds the same two real super_admin addresses. Without this guard a single dead
 * key produces two identical emails a week to the same people, and an alert that
 * arrives in duplicate is an alert that gets filtered.
 *
 * Staging still runs the probe and still writes a heartbeat — that remains a
 * genuine canary for the route itself — it just does not send mail.
 *
 * @returns true when running against the production domain.
 */
function isProductionEnvironment(): boolean {
  try {
    return new URL(getBaseUrl()).hostname.replace(/^www\./, "") === PRODUCTION_HOST;
  } catch {
    // An unparseable base URL is not a reason to start emailing from staging.
    return false;
  }
}

/** Row colour per status — dead and probe_failed both read as red. */
const STATUS_COLOUR: Record<string, string> = {
  dead: "#dc2626",
  probe_failed: "#dc2626",
  degraded: "#d97706",
  healthy: "#166534",
  unconfigured: "#6b7280",
};

/** Human label per status, used as the row's leading badge. */
const STATUS_LABEL: Record<string, string> = {
  dead: "DEAD",
  probe_failed: "UNKNOWN",
  degraded: "DEGRADED",
  healthy: "EXPIRING",
  unconfigured: "NOT SET",
};

/**
 * Renders one probe as a table row.
 * @param probe - The probe needing attention.
 * @returns An HTML table row.
 */
function probeRow(probe: CredentialProbe): string {
  const colour = STATUS_COLOUR[probe.status] ?? "#374151";
  const badge = STATUS_LABEL[probe.status] ?? probe.status.toUpperCase();
  const expiry =
    probe.daysUntilExpiry !== null
      ? ` (${probe.daysUntilExpiry} day${probe.daysUntilExpiry === 1 ? "" : "s"} left)`
      : "";

  return `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-size:12px;font-weight:700;color:${colour};white-space:nowrap;vertical-align:top;">${badge}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-size:13px;color:#111827;font-weight:600;vertical-align:top;">${escapeHtml(probe.label)}${expiry}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-size:13px;color:#374151;vertical-align:top;">${escapeHtml(probe.detail)}</td>
    </tr>`;
}

/**
 * Builds the subject and body for the credential alert.
 * Pure — no I/O — so the wording is unit-testable without sending mail.
 *
 * @param summary - Result of summarizeProbes(); assumed non-healthy.
 * @param baseUrl - App base URL for the admin link.
 * @returns Subject and HTML body.
 */
export function credentialAlertEmail(
  summary: ProbeSummary,
  baseUrl: string
): { subject: string; html: string } {
  const deadCount = summary.dead.length + summary.failed.length;
  const subject =
    deadCount > 0
      ? `[SuperheroCPR] ${deadCount} credential${deadCount === 1 ? "" : "s"} need attention`
      : `[SuperheroCPR] Credential warning (${summary.actionable.length})`;

  const rows = summary.actionable.map(probeRow).join("");
  const headline =
    deadCount > 0
      ? "A third-party credential is not working"
      : "A third-party credential needs attention soon";

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;">
      <h2 style="font-size:18px;color:#111827;margin:0 0 4px;">${headline}</h2>
      <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">
        ${summary.probesRun} credential${summary.probesRun === 1 ? "" : "s"} checked ·
        ${summary.actionable.length} need${summary.actionable.length === 1 ? "s" : ""} attention
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #fecaca;border-radius:6px;">
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:12px;color:#6b7280;margin:20px 0 0;line-height:1.6;">
        These credentials fail silently — the affected feature degrades quietly instead of
        erroring, so this email is the only signal. Re-run the check from
        <a href="${escapeHtml(baseUrl)}/admin/settings" style="color:#dc2626;">admin settings</a>
        after fixing one.
      </p>
    </div>`;

  return { subject, html };
}

/**
 * Emails every active super_admin about credentials needing attention.
 *
 * Side effects: reads profiles, sends one email via Resend. Never throws.
 *
 * Note the ordering hazard this handles: if Resend itself is the dead credential,
 * this send will fail. That is why the probe route also writes every result to
 * the console and returns a non-2xx — the heartbeat and the logs remain as
 * signals when email is the thing that is broken.
 *
 * @param summary - Result of summarizeProbes(). No-ops when healthy.
 */
export async function notifyCredentialProblems(summary: ProbeSummary): Promise<void> {
  if (summary.healthy || summary.actionable.length === 0) return;

  if (!isProductionEnvironment()) {
    console.warn(
      `[credential-notify] ${summary.actionable.length} credential(s) need attention, ` +
        `but this is not production — alert email suppressed to avoid duplicating ` +
        `production's. Results are in the probe-credentials logs and cron_run_log.`
    );
    return;
  }

  try {
    if (!isEmailConfigured()) {
      console.warn("[credential-notify] Resend not configured — skipping alert email.");
      return;
    }

    const admin = await createAdminClient();
    const { data: admins } = await admin
      .from("profiles")
      .select("email")
      .eq("role", "super_admin")
      .eq("archived", false)
      .eq("deactivated", false);

    const recipients = ((admins ?? []) as { email: string | null }[])
      .map((row) => row.email)
      .filter((email): email is string => Boolean(email));

    if (recipients.length === 0) {
      console.warn("[credential-notify] No active super_admin recipients — alert not sent.");
      return;
    }

    const email = credentialAlertEmail(summary, getBaseUrl());
    await sendEmail({
      context: "credential-notify:alert",
      to: recipients,
      subject: email.subject,
      html: email.html,
    });
  } catch (err) {
    console.error("[credential-notify] Alert failed (non-fatal):", err);
  }
}
