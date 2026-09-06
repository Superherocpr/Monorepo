/**
 * POST /api/admin/team-bookings/retry-invoices
 * Called by:
 *   - pg_cron job `retry-team-booking-invoices` (migration 0067) — daily at
 *     13:00 UTC (CRON_SECRET bearer)
 *   - Super admin, for manual testing (super_admin session)
 * Auth: super_admin session OR Authorization: Bearer {CRON_SECRET}
 *
 * Finds company-paid team bookings older than the grace window that still have
 * no invoice attached — the same population as the `team_booking_company_no_invoice`
 * SQL invariant (migration 0056) — retries invoice creation on each, and emails
 * super_admins a digest of whatever is still outstanding afterwards.
 *
 * This closes the gap the invariant only detected: the invariant is a number on
 * a maintenance checklist somebody has to remember to run, whereas this both
 * fixes the common case on its own and pages a human when it cannot.
 *
 * Retries are safe. ensureTeamInvoice() re-reads each booking and short-circuits
 * when an invoice already exists, so a booking rescued by an admin between runs
 * is never billed twice.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import {
  ensureTeamInvoice,
  notifyTeamInvoiceMissing,
} from "@/lib/team-bookings";
import type { TeamInvoiceAlertBooking } from "@/lib/emails";
import { isCronRequest, withCronHeartbeat } from "@/lib/cron-heartbeat";

/**
 * How long after creation a missing invoice counts as a failure rather than as
 * work still in flight. Matches the 1-hour grace in the SQL invariant so the
 * two never disagree about which bookings are breaches.
 */
const GRACE_HOURS = 1;

/**
 * Safety cap on retries per run. A systemic PayPal outage would otherwise make
 * one cron run fire an unbounded number of live invoice calls; whatever is left
 * over is picked up by the next run and is still reported in the digest.
 */
const MAX_RETRIES_PER_RUN = 25;

/**
 * How long after a class has run this job will still bill for it unattended.
 *
 * Raising an invoice is a live PayPal call and a real email to a customer.
 * Doing that automatically for a class that happened weeks ago is a decision a
 * person should make — the booking may have been settled off-platform, written
 * off, or abandoned, and none of that is visible from here. Past this window the
 * booking is still reported in the digest every day; it just needs a human to
 * press the button on /admin/team-bookings.
 *
 * This also keeps stale test data from ever reaching PayPal, which matters
 * because staging runs against the LIVE merchant account (THREAT-065).
 */
const AUTO_BILL_GRACE_DAYS = 7;

/** The team_bookings columns the sweep needs, with the joined class date. */
interface UninvoicedRow {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  total_price: number | string | null;
  created_at: string;
  created_by: string;
  class_sessions: { starts_at: string } | { starts_at: string }[] | null;
}

/**
 * Reads the class start date off a PostgREST embedded relation, which arrives
 * as an object or a single-element array depending on the join.
 * @param row - One uninvoiced team booking row.
 * @returns The ISO class start, or null when the session could not be embedded.
 */
function classDateOf(row: UninvoicedRow): string | null {
  const session = Array.isArray(row.class_sessions) ? row.class_sessions[0] : row.class_sessions;
  return session?.starts_at ?? null;
}

/**
 * Sweeps company-mode team bookings with no invoice, retries each, and alerts
 * on whatever is still uninvoiced afterwards.
 * Side effects: for each rescued booking a PayPal invoice creation + send,
 * invoices and invoice_activity_log inserts, a Resend email to the contact, and
 * an UPDATE on team_bookings.invoice_id; plus at most one digest email to
 * super_admins.
 * @param request - No body required.
 */
async function handlePOST(request: Request): Promise<Response> {
  const viaCron = isCronRequest(request);
  let actorId: string | null = null;

  if (!viaCron) {
    const authResult = await requireApiRole(["super_admin"]);
    if ("error" in authResult) return authResult.error;
    actorId = authResult.actor.user.id;
  }

  const adminClient = await createAdminClient();
  const cutoff = new Date(Date.now() - GRACE_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await adminClient
    .from("team_bookings")
    .select(
      `id, company_name, contact_name, contact_email, total_price, created_at, created_by,
       class_sessions ( starts_at )`
    )
    .eq("payment_mode", "company")
    .is("invoice_id", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[team-bookings/retry-invoices] Lookup failed:", error);
    return Response.json(
      { success: false, error: "Failed to load team bookings." },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as unknown as UninvoicedRow[];

  if (rows.length === 0) {
    return Response.json({
      success: true,
      created: 0,
      stillMissing: 0,
      triggeredBy: viaCron ? "cron" : actorId,
    });
  }

  let created = 0;
  const stillMissing: TeamInvoiceAlertBooking[] = [];

  const autoBillFloor = Date.now() - AUTO_BILL_GRACE_DAYS * 24 * 60 * 60 * 1000;

  // Deliberately sequential. Each iteration makes live PayPal calls and sends a
  // real invoice email; running them in parallel would multiply the blast radius
  // of a bad batch and risks PayPal rate limits.
  for (const row of rows.slice(0, MAX_RETRIES_PER_RUN)) {
    const classStart = classDateOf(row);

    // Too old to bill without a person looking at it. Reported, never charged.
    if (classStart !== null && new Date(classStart).getTime() < autoBillFloor) {
      stillMissing.push({
        teamBookingId: row.id,
        companyName: row.company_name,
        contactName: row.contact_name,
        contactEmail: row.contact_email,
        totalPrice: Number(row.total_price) || 0,
        createdAt: row.created_at,
        classDate: classStart,
        lastError:
          "The class already ran, so this was not billed automatically. Raise the invoice by hand if the company still owes for it.",
      });
      continue;
    }

    // invoice_activity_log.actor_id is NOT NULL and FK-bound to profiles, and a
    // cron run has no human actor — so the recovered invoice is attributed to
    // whoever created the booking (team_bookings.created_by is NOT NULL).
    const result = await ensureTeamInvoice(adminClient, {
      teamBookingId: row.id,
      actorId: actorId ?? row.created_by,
    });

    const base = {
      teamBookingId: row.id,
      companyName: row.company_name,
      contactName: row.contact_name,
      contactEmail: row.contact_email,
      totalPrice: Number(row.total_price) || 0,
      createdAt: row.created_at,
      classDate: classDateOf(row),
    };

    switch (result.status) {
      case "created":
      case "already_linked":
        created += result.status === "created" ? 1 : 0;
        break;

      case "created_unlinked":
        // Money moved but the link did not. Never retried again by the sweep —
        // the next run sees invoice_id still null, so it is called out
        // explicitly here to stop an operator from raising a duplicate.
        stillMissing.push({
          ...base,
          lastError: `Invoice ${result.invoiceNumber} was raised but not linked. Do NOT retry — link team_bookings.invoice_id by hand.`,
        });
        break;

      case "not_applicable":
        stillMissing.push({ ...base, lastError: result.reason });
        break;

      case "failed":
        stillMissing.push({ ...base, lastError: result.error });
        break;
    }
  }

  // Anything past the per-run cap is still outstanding and belongs in the digest.
  for (const row of rows.slice(MAX_RETRIES_PER_RUN)) {
    stillMissing.push({
      teamBookingId: row.id,
      companyName: row.company_name,
      contactName: row.contact_name,
      contactEmail: row.contact_email,
      totalPrice: Number(row.total_price) || 0,
      createdAt: row.created_at,
      classDate: classDateOf(row),
      lastError: "Not retried this run — per-run retry cap reached.",
    });
  }

  if (stillMissing.length > 0) {
    await notifyTeamInvoiceMissing(adminClient, stillMissing, "sweep");
  }

  return Response.json({
    success: true,
    created,
    stillMissing: stillMissing.length,
    triggeredBy: viaCron ? "cron" : actorId,
  });
}

/**
 * Cron-invoked entry point. The heartbeat wrapper records a cron_run_log row on
 * every outcome so cron_health() can prove this job ran — pg_cron's own
 * job_run_details cannot, because net.http_post is fire-and-forget (migration
 * 0057). Manual super-admin triggers pass straight through unlogged, so a hand
 * test never masks a dead schedule.
 */
export const POST = withCronHeartbeat("retry-team-booking-invoices", handlePOST);
