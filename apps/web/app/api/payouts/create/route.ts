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
 * Creates and sends one PayPal payout batch for all currently pending earnings.
 * Side effects: database reservation + PayPal Payouts API call + DB status updates.
 * @param request - Incoming HTTP request (used for cron auth and source header).
 */
export async function POST(request: Request) {
  let actorId: string;

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
  }

  const adminClient = await createAdminClient();
  const { data, error } = await adminClient.rpc("reserve_instructor_payout_batch", {
    p_actor_id: actorId,
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
            ? "No pending earnings are ready to pay. Check that instructors have payout emails saved."
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
  });
}
