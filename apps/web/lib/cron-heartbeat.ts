/**
 * Cron heartbeat — proof that a scheduled job actually did its work.
 *
 * WHY THIS EXISTS
 *   Seven of the eight pg_cron jobs invoke an API route via `net.http_post`,
 *   which is fire-and-forget. `cron.job_run_details.status` therefore reports
 *   whether Postgres QUEUED the request, not whether the endpoint ran — it says
 *   'succeeded' even when the call times out and never lands. That is exactly
 *   what happened to alert-stuck-payout-batches on 2026-08-19.
 *
 *   pg_net's own `net._http_response` does record the truth, but self-prunes
 *   after ~6 hours, so no daily or weekly check can ever see a failure there.
 *   The only durable answer is for the endpoint to record its own completion,
 *   which is what this module does (table + cron_health() in migration 0057).
 *
 *   It also means a slow-but-successful run is reported correctly: the daily
 *   summary sends one email per admin and can outlive any HTTP timeout, yet
 *   still finished its work.
 *
 * USAGE
 *   export const POST = withCronHeartbeat("job-name", async (request) => { ... });
 */

import { createAdminClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verifies an Authorization: Bearer {CRON_SECRET} header on the request.
 *
 * Shared so the heartbeat agrees with the routes about what counts as a cron
 * invocation. Several routes still carry a private copy of this check; those
 * are candidates for consolidation onto this one.
 *
 * @param request - Incoming HTTP request.
 * @returns true when the bearer token matches CRON_SECRET, false otherwise.
 */
export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (request.headers.get("Authorization") ?? "") === `Bearer ${secret}`;
}

/** Response body keys that, when numeric, are worth recording as work done. */
const RECORD_COUNT_KEYS = [
  "alerted",
  "upserted",
  "sent",
  "notified",
  "processed",
  "reconciled",
  "created",
  "updated",
  "count",
] as const;

/**
 * Extracts a "records touched" count from a JSON response body, if one is
 * obvious. Lets the log distinguish "ran and did nothing" from "ran and worked",
 * which a success boolean alone cannot express.
 *
 * Reads a CLONE of the response so the original body stays unconsumed and the
 * caller still receives it intact.
 *
 * @param response - The response the handler produced.
 * @returns The first matching numeric field, or null if none is found.
 */
async function extractRecordCount(response: Response): Promise<number | null> {
  try {
    const body: unknown = await response.clone().json();
    if (typeof body !== "object" || body === null) return null;

    const record = body as Record<string, unknown>;
    for (const key of RECORD_COUNT_KEYS) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
  } catch {
    // Non-JSON or already-consumed body. Not worth failing the request over.
    return null;
  }
}

/**
 * Writes one heartbeat row. Never throws — a logging failure must not turn a
 * successful job into a failed HTTP response.
 * Side effects: one INSERT into cron_run_log.
 *
 * @param jobName - pg_cron job name, must match cron.job.jobname exactly or
 *                  cron_health() will report the job as never having run.
 * @param ok - Whether the job completed its work.
 * @param durationMs - Wall-clock duration of the handler.
 * @param recordsTouched - Rows affected, when derivable.
 * @param errorMessage - Failure detail, truncated to keep the log readable.
 */
async function writeHeartbeat(
  jobName: string,
  ok: boolean,
  durationMs: number,
  recordsTouched: number | null,
  errorMessage: string | null
): Promise<void> {
  try {
    const admin = await createAdminClient();
    const { error } = await admin.from("cron_run_log").insert({
      job_name: jobName,
      ok,
      duration_ms: durationMs,
      records_touched: recordsTouched,
      error_message: errorMessage ? errorMessage.slice(0, 1000) : null,
    });

    if (error) {
      console.error(`[cron-heartbeat] failed to log run for ${jobName}`, error);
    }
  } catch (err) {
    console.error(`[cron-heartbeat] failed to log run for ${jobName}`, err);
  }
}

/**
 * Wraps a cron-invoked route handler so every outcome is recorded.
 *
 * Only logs when the request carries a valid CRON_SECRET. These routes are
 * dual-purpose — an admin can also trigger them by hand — and counting a manual
 * trigger as a heartbeat would mask a broken schedule: someone clicks the
 * button, the job looks healthy, and nobody notices the cron itself stopped.
 *
 * Side effects: one INSERT into cron_run_log per cron-invoked call.
 *
 * @param jobName - pg_cron job name, must match cron.job.jobname exactly.
 * @param handler - The route handler to wrap.
 * @returns A handler with identical behaviour that also records a heartbeat.
 */
export function withCronHeartbeat<T extends Request>(
  jobName: string,
  handler: (request: T) => Promise<Response>
): (request: T) => Promise<Response> {
  return async (request: T): Promise<Response> => {
    if (!isCronRequest(request)) return handler(request);

    const started = Date.now();

    try {
      const response = await handler(request);
      const durationMs = Date.now() - started;

      // A non-2xx from the handler is a failed run even though nothing threw —
      // an auth rejection or an upstream error still means the work didn't happen.
      const recordsTouched = response.ok ? await extractRecordCount(response) : null;
      const errorMessage = response.ok ? null : `HTTP ${response.status}`;

      await writeHeartbeat(jobName, response.ok, durationMs, recordsTouched, errorMessage);
      return response;
    } catch (err) {
      const durationMs = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);

      await writeHeartbeat(jobName, false, durationMs, null, message);
      // Rethrow so the route's own error handling and the platform's logging
      // behave exactly as they did before the heartbeat was added.
      throw err;
    }
  };
}

// ── Reading heartbeat status ─────────────────────────────────────────────────

/** One scheduled job's heartbeat status, from public.cron_health(). */
export interface CronJobHealth {
  jobName: string;
  schedule: string;
  /** Last successful run, or null if the job has never reported in. */
  lastSuccess: string | null;
  /** Minutes since the last success, or null if it has never reported in. */
  minutesSince: number | null;
  /** Allowed gap before the job is considered overdue. */
  maxGapMinutes: number;
  isOverdue: boolean;
}

/** Aggregate heartbeat view for the daily digest. */
export interface CronHealthSummary {
  /** Active jobs found in cron.job. Zero means the check itself failed. */
  jobsTracked: number;
  /** Jobs that have not reported a successful run within their allowed gap. */
  overdue: CronJobHealth[];
  /** True only when at least one job was tracked and none are overdue. */
  healthy: boolean;
}

/** Raw snake_case row shape as returned by PostgREST. */
interface CronHealthRow {
  job_name: string;
  schedule: string;
  last_success: string | null;
  minutes_since: number | string | null;
  max_gap_minutes: number | string;
  is_overdue: boolean;
}

/**
 * Calls public.cron_health() and returns each active job's heartbeat status.
 * Side effects: one read-only RPC round trip.
 *
 * Never throws. On error it returns [], which summarizeCronHealth reports as
 * `healthy: false` with `jobsTracked: 0` — a broken check surfaces as a problem
 * rather than as silence.
 *
 * @param admin - RLS-bypassing Supabase admin client; the RPC is granted to
 *                service_role only.
 * @returns Per-job heartbeat status, or [] if the call failed.
 */
export async function fetchCronHealth(
  admin: SupabaseClient
): Promise<CronJobHealth[]> {
  const { data, error } = await admin.rpc("cron_health");

  if (error) {
    console.error("[cron-heartbeat] cron_health RPC failed", error);
    return [];
  }

  return ((data ?? []) as CronHealthRow[]).map((row) => ({
    jobName: row.job_name,
    schedule: row.schedule,
    lastSuccess: row.last_success,
    minutesSince: row.minutes_since === null ? null : Number(row.minutes_since),
    maxGapMinutes: Number(row.max_gap_minutes),
    isOverdue: row.is_overdue,
  }));
}

/**
 * Reduces per-job heartbeat rows to the numbers the digest reports.
 * Pure — no I/O — so the reporting logic is unit-testable without a database.
 * @param jobs - Every active job returned by the RPC.
 * @returns Aggregate counts plus the overdue jobs, longest-overdue first.
 */
export function summarizeCronHealth(jobs: CronJobHealth[]): CronHealthSummary {
  const overdue = jobs
    .filter((j) => j.isOverdue)
    // Never-reported jobs (null) sort first: they are the least explicable.
    .sort((a, b) => (b.minutesSince ?? Infinity) - (a.minutesSince ?? Infinity));

  return {
    jobsTracked: jobs.length,
    overdue,
    healthy: jobs.length > 0 && overdue.length === 0,
  };
}
