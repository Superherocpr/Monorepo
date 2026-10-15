/**
 * POST /api/payouts/create
 * Called by:
 *   - Admin Payouts page / Admin Settings Payouts tab — manual send (super_admin session)
 *   - lib/payout-trigger.ts — immediate auto-trigger after each payment (CRON_SECRET bearer)
 *   - pg_cron job (migration 0021) — scheduled auto-trigger (CRON_SECRET bearer)
 * Auth: super_admin session OR Authorization: Bearer {CRON_SECRET}
 *
 * Behaviour when called via cron/system bearer:
 *   - X-Payout-Source: "immediate" — always runs (trigger already verified by caller)
 *   - X-Payout-Source: "scheduled" — checks payout_trigger = "scheduled" and whether
 *     today matches payout_schedule (daily/weekly/monthly) before proceeding
 *
 * Body (session path only, optional): { earningIds: string[] }
 *   Omitted      -> every eligible pending earning (what the automatic modes do).
 *   A list       -> ONLY those earnings, each re-checked for eligibility inside the
 *                   reservation function. An empty or malformed list is rejected
 *                   with 400; it must never be read as "everything". Cron callers
 *                   cannot narrow a batch: their body is ignored.
 *
 * Atomically reserves pending instructor earnings, then hands the reservation to
 * submitReservedPayout() — shared with POST /api/payouts/retry — which sends the
 * PayPal batch and records the result. A successful send leaves the batch
 * `assumed_complete`, not `completed`: PayPal accepting a batch is not proof it
 * delivered the money.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { submitReservedPayout } from "@/lib/payout-submit";
import type { ReservedPayoutResult } from "@/types/payouts";
import { isCronRequest, withCronHeartbeat } from "@/lib/cron-heartbeat";

/** Most earnings one manual payout may name; far above any real batch. */
const MAX_SELECTED_EARNINGS = 1000;

/** Matches a canonical UUID, so only well-formed ids ever reach the database. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Outcome of reading the optional earning selection from a request body. */
type SelectionParse =
  | { ok: true; earningIds: string[] | null }
  | { ok: false; error: string };

/**
 * Reads the optional `earningIds` selection from a request body.
 * @param body - Parsed JSON body, or null when absent or unparseable.
 * @returns null ids when no selection was sent; otherwise a validated, de-duplicated
 *          list. A key that is present but empty, oversized or malformed is an error.
 */
function parseSelection(body: unknown): SelectionParse {
  if (typeof body !== "object" || body === null || !("earningIds" in body)) {
    return { ok: true, earningIds: null };
  }
  const ids = (body as { earningIds: unknown }).earningIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_SELECTED_EARNINGS ||
    !ids.every((id): id is string => typeof id === "string" && UUID_PATTERN.test(id))
  ) {
    return { ok: false, error: "Choose at least one valid earning to pay out." };
  }
  return { ok: true, earningIds: [...new Set(ids.map((id) => id.toLowerCase()))] };
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


/**
 * Finds the UUID of any active super_admin to use as the actor for system-triggered payouts.
 * The RPC requires a super_admin UUID for audit trail even when called by the system.
 * @returns super_admin UUID, or null if none exists.
 */
async function getSystemActorId(): Promise<string | null> {
  const adminClient = await createAdminClient();
  const { data } = await adminClient
    .from("profiles")
    .select("id")
    .eq("role", "super_admin")
    .eq("archived", false)
    .eq("deactivated", false)
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Reads payout_trigger and payout_schedule from system_settings.
 * @returns An object with trigger and schedule strings.
 */
async function getPayoutScheduleSettings(): Promise<{
  trigger: string;
  schedule: string;
}> {
  const adminClient = await createAdminClient();
  const { data } = await adminClient
    .from("system_settings")
    .select("key, value")
    .in("key", ["payout_trigger", "payout_schedule"]);

  const map = new Map<string, string>(
    ((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value])
  );
  return {
    trigger: map.get("payout_trigger") ?? "manual",
    schedule: map.get("payout_schedule") ?? "daily",
  };
}

/**
 * Returns true when the current UTC date/time matches the configured schedule.
 * @param schedule - "daily" | "weekly" | "monthly"
 */
function isScheduleDue(schedule: string): boolean {
  const now = new Date();
  // Daily: always due
  if (schedule === "daily") return true;
  // Weekly: due on Monday (UTC day 1)
  if (schedule === "weekly") return now.getUTCDay() === 1;
  // Monthly: due on the 1st
  if (schedule === "monthly") return now.getUTCDate() === 1;
  return false;
}

/**
 * Creates and sends one PayPal payout batch for the pending earnings an admin
 * selected, or for all of them when no selection is given.
 * Side effects: database reservation + PayPal Payouts API call + DB status updates.
 * @param request - Incoming HTTP request (used for cron auth and source header).
 */
async function handlePOST(request: Request) {
  let actorId: string;
  // Only an admin's session may narrow a batch; automatic triggers pay everyone eligible.
  let earningIds: string[] | null = null;

  // ── Cron / system bearer path ────────────────────────────────────────────
  if (isCronRequest(request)) {
    const source = request.headers.get("X-Payout-Source") ?? "scheduled";

    if (source === "scheduled") {
      // Only proceed if the system is configured for scheduled payouts and today is due.
      const { trigger, schedule } = await getPayoutScheduleSettings();
      if (trigger !== "scheduled") {
        // Not in scheduled mode — cron call is intentional no-op
        return Response.json({ success: true, skipped: true, reason: "trigger_not_scheduled" });
      }
      if (!isScheduleDue(schedule)) {
        return Response.json({ success: true, skipped: true, reason: "not_due_today" });
      }
    }
    // For "immediate" source we run unconditionally — the caller already verified intent.

    const systemActor = await getSystemActorId();
    if (!systemActor) {
      console.error("[payouts/create] No active super_admin found for system-triggered payout.");
      return Response.json(
        { success: false, error: "No active super_admin available for system payout." },
        { status: 500 }
      );
    }
    actorId = systemActor;
  } else {
    // ── Session-based path (admin clicking from the UI) ──────────────────
    const sessionActor = await requireSuperAdmin();
    if (sessionActor instanceof Response) return sessionActor;
    actorId = sessionActor;

    const selection = parseSelection(await request.json().catch(() => null));
    if (!selection.ok) {
      return Response.json({ success: false, error: selection.error }, { status: 400 });
    }
    earningIds = selection.earningIds;
  }

  const adminClient = await createAdminClient();
  // p_earning_ids is left out entirely for "everyone eligible" so that path keeps
  // working against the database before migration 0078 adds the parameter.
  const { data, error } = await adminClient.rpc("reserve_instructor_payout_batch", {
    p_actor_id: actorId,
    ...(earningIds ? { p_earning_ids: earningIds } : {}),
  });

  if (error) {
    if (error.message?.includes("forbidden")) {
      return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    console.error("[payouts/create] Reservation failed:", error);
    return Response.json(
      { success: false, error: "Failed to reserve payout earnings." },
      { status: 500 }
    );
  }

  const reservation = data as ReservedPayoutResult | null;
  if (!reservation?.success || !reservation.batch || !reservation.items?.length) {
    return Response.json(
      {
        success: false,
        error:
          reservation?.reason === "no_eligible_earnings"
            ? earningIds
              ? "None of the selected earnings could be paid. They may already have been sent, or the instructor has no payout email saved."
              : "No pending earnings are ready to pay. Check that instructors have payout emails saved."
            : "No eligible payouts found.",
      },
      { status: 400 }
    );
  }

  const result = await submitReservedPayout(adminClient, reservation);

  if (!result.success) {
    return Response.json(
      { success: false, error: result.error },
      { status: result.httpStatus }
    );
  }

  return Response.json({
    success: true,
    batchId: result.batchId,
    paypalBatchId: result.paypalBatchId,
    totalAmount: result.totalAmount,
    itemCount: result.itemCount,
    // Lets the UI say so when some selected earnings had already moved on.
    requestedCount: earningIds ? earningIds.length : null,
    reservedCount: reservation.reserved_count ?? null,
  });
}

/**
 * Cron-invoked entry point. The heartbeat wrapper records a cron_run_log row on
 * every outcome so cron_health() can prove this job actually ran — pg_cron's own
 * job_run_details cannot, because net.http_post is fire-and-forget (migration 0057).
 * Manual admin triggers pass straight through unlogged.
 */
export const POST = withCronHeartbeat("scheduled-instructor-payouts", handlePOST);
