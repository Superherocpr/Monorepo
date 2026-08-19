/**
 * Data-consistency canary.
 *
 * Wraps the public.health_invariants() Postgres function (migration 0056), which
 * runs a fixed set of cross-table consistency checks and returns EVERY check with
 * its breach count — not just the failures.
 *
 * Returning the passing checks too is deliberate. A canary that only speaks up
 * when something is wrong is indistinguishable from a canary that stopped running.
 * `checksRun` in the summary is what proves the thing executed at all.
 *
 * Consumed by /api/admin/daily-summary.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Severity of a single invariant. `critical` implies money or roster integrity. */
export type InvariantSeverity = "critical" | "warning";

/** One row returned by public.health_invariants(). */
export interface HealthInvariant {
  /** Stable machine name, e.g. "booking_missing_payment". */
  checkName: string;
  severity: InvariantSeverity;
  /** Number of rows violating the invariant. 0 means healthy. */
  breachCount: number;
  /** Human-readable description of what the check looks for. */
  detail: string;
}

/** Aggregate view of one invariant run, suitable for rendering in the digest. */
export interface InvariantSummary {
  /** Total checks that ran. Zero means the canary itself failed — not that all is well. */
  checksRun: number;
  /** Checks with a non-zero breach count. */
  breachedCount: number;
  /** Sum of breach counts across critical checks. */
  criticalBreaches: number;
  /** Sum of breach counts across warning checks. */
  warningBreaches: number;
  /** True only when at least one check ran and none were breached. */
  healthy: boolean;
  /** Breached checks only, criticals first, then by descending breach count. */
  breached: HealthInvariant[];
}

/** Raw snake_case row shape as returned by PostgREST. */
interface HealthInvariantRow {
  check_name: string;
  severity: string;
  breach_count: number | string;
  detail: string;
}

/**
 * Normalises one raw RPC row into a HealthInvariant.
 * Postgres bigint arrives as a string over PostgREST, so breach_count is coerced.
 * An unrecognised severity is treated as "warning" rather than dropped — an
 * unknown check is still worth showing.
 * @param row - Raw row from the RPC.
 * @returns The normalised invariant.
 */
function normaliseRow(row: HealthInvariantRow): HealthInvariant {
  return {
    checkName: row.check_name,
    severity: row.severity === "critical" ? "critical" : "warning",
    breachCount: Number(row.breach_count ?? 0),
    detail: row.detail,
  };
}

/**
 * Reduces a full set of invariant results to the numbers the digest reports.
 * Pure — no I/O — so the reporting logic is unit-testable without a database.
 * @param invariants - Every check returned by the RPC, breached or not.
 * @returns Aggregate counts plus the breached checks, ranked for display.
 */
export function summarizeInvariants(invariants: HealthInvariant[]): InvariantSummary {
  const breached = invariants
    .filter((i) => i.breachCount > 0)
    .sort((a, b) => {
      // Criticals always outrank warnings regardless of count — one missing
      // payment matters more than twenty stale timestamps.
      if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
      return b.breachCount - a.breachCount;
    });

  const criticalBreaches = breached
    .filter((i) => i.severity === "critical")
    .reduce((sum, i) => sum + i.breachCount, 0);

  const warningBreaches = breached
    .filter((i) => i.severity === "warning")
    .reduce((sum, i) => sum + i.breachCount, 0);

  return {
    checksRun: invariants.length,
    breachedCount: breached.length,
    criticalBreaches,
    warningBreaches,
    // An empty result set is a canary failure, not a clean bill of health.
    healthy: invariants.length > 0 && breached.length === 0,
    breached,
  };
}

/**
 * Calls public.health_invariants() and returns the normalised results.
 * Side effects: one read-only RPC round trip against every checked table.
 *
 * Never throws. On error it returns an empty array, which summarizeInvariants
 * reports as `healthy: false` with `checksRun: 0` — so a broken canary surfaces
 * in the digest as a problem rather than as silence.
 *
 * @param admin - RLS-bypassing Supabase admin client. The RPC is SECURITY DEFINER
 *                and granted to service_role only, so an anon client will fail.
 * @returns Every check with its breach count, or [] if the call failed.
 */
export async function fetchHealthInvariants(
  admin: SupabaseClient
): Promise<HealthInvariant[]> {
  const { data, error } = await admin.rpc("health_invariants");

  if (error) {
    console.error("[health-invariants] RPC failed", error);
    return [];
  }

  return ((data ?? []) as HealthInvariantRow[]).map(normaliseRow);
}
