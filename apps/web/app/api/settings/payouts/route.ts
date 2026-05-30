/**
 * GET /api/settings/payouts
 * PATCH /api/settings/payouts
 * Called by: Admin Settings → Payouts tab (PayoutSettingsPanel)
 * Auth: super_admin only
 *
 * GET  — Returns current payout settings from system_settings.
 * PATCH — Saves platform_fee_percent, payout_trigger, and payout_schedule.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/** Valid values for the payout trigger setting. */
export type PayoutTrigger = "immediate" | "scheduled" | "manual";

/** Valid values for the payout schedule setting. */
export type PayoutSchedule = "daily" | "weekly" | "monthly";

const VALID_TRIGGERS: PayoutTrigger[] = ["immediate", "scheduled", "manual"];
const VALID_SCHEDULES: PayoutSchedule[] = ["daily", "weekly", "monthly"];

/** Current payout configuration returned by GET. */
export interface PayoutSettings {
  platformFeePercent: number;
  payoutTrigger: PayoutTrigger;
  payoutSchedule: PayoutSchedule;
}

/**
 * Verifies the caller is an active super_admin.
 * Returns the Supabase client and user id, or a Response on failure.
 */
async function requireSuperAdmin(): Promise<
  | { supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
  | Response
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, archived, deactivated")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    (profile.role as UserRole) !== "super_admin" ||
    profile.archived ||
    profile.deactivated
  ) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  return { supabase, userId: user.id };
}

/**
 * Reads three system_settings rows in one query and returns typed values with safe fallbacks.
 * @param supabase - Authenticated Supabase client.
 * @returns Current payout configuration.
 */
async function readPayoutSettings(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<PayoutSettings> {
  const { data } = await supabase
    .from("system_settings")
    .select("key, value")
    .in("key", ["platform_fee_percent", "payout_trigger", "payout_schedule"]);

  const map = new Map<string, string>(
    (data ?? []).map((row: { key: string; value: string }) => [row.key, row.value])
  );

  const rawFee = Number(map.get("platform_fee_percent") ?? "20");
  const platformFeePercent = Number.isFinite(rawFee)
    ? Math.min(100, Math.max(0, rawFee))
    : 20;

  const rawTrigger = map.get("payout_trigger") ?? "manual";
  const payoutTrigger: PayoutTrigger = (VALID_TRIGGERS as string[]).includes(rawTrigger)
    ? (rawTrigger as PayoutTrigger)
    : "manual";

  const rawSchedule = map.get("payout_schedule") ?? "daily";
  const payoutSchedule: PayoutSchedule = (VALID_SCHEDULES as string[]).includes(rawSchedule)
    ? (rawSchedule as PayoutSchedule)
    : "daily";

  return { platformFeePercent, payoutTrigger, payoutSchedule };
}

/**
 * Returns the current payout settings.
 * Response: { success: true, settings: PayoutSettings }
 */
export async function GET() {
  const result = await requireSuperAdmin();
  if (result instanceof Response) return result;
  const { supabase } = result;

  try {
    const settings = await readPayoutSettings(supabase);
    return Response.json({ success: true, settings });
  } catch (err) {
    console.error("[/api/settings/payouts GET] Error:", err);
    return Response.json(
      { success: false, error: "Failed to load payout settings." },
      { status: 500 }
    );
  }
}

/**
 * Saves payout settings to system_settings.
 * Expects JSON body: { platformFeePercent: number, payoutTrigger: string, payoutSchedule: string }
 * Response: { success: true, settings: PayoutSettings }
 */
export async function PATCH(request: Request) {
  const result = await requireSuperAdmin();
  if (result instanceof Response) return result;
  const { supabase } = result;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { platformFeePercent, payoutTrigger, payoutSchedule } = body as Record<string, unknown>;

  // Validate platform fee percent
  if (typeof platformFeePercent !== "number" || !Number.isFinite(platformFeePercent)) {
    return Response.json(
      { success: false, error: "platformFeePercent must be a finite number." },
      { status: 400 }
    );
  }
  const clampedFee = Math.min(100, Math.max(0, Math.round(platformFeePercent * 100) / 100));

  // Validate trigger
  if (!(VALID_TRIGGERS as unknown[]).includes(payoutTrigger)) {
    return Response.json(
      { success: false, error: `payoutTrigger must be one of: ${VALID_TRIGGERS.join(", ")}.` },
      { status: 400 }
    );
  }

  // Validate schedule (only required when trigger is scheduled, but we always save it)
  if (!(VALID_SCHEDULES as unknown[]).includes(payoutSchedule)) {
    return Response.json(
      { success: false, error: `payoutSchedule must be one of: ${VALID_SCHEDULES.join(", ")}.` },
      { status: 400 }
    );
  }

  // Upsert all three settings atomically via individual upserts
  const upserts = [
    { key: "platform_fee_percent", value: String(clampedFee) },
    { key: "payout_trigger", value: payoutTrigger as string },
    { key: "payout_schedule", value: payoutSchedule as string },
  ];

  for (const row of upserts) {
    const { error } = await supabase
      .from("system_settings")
      .upsert(row, { onConflict: "key" });
    if (error) {
      console.error("[/api/settings/payouts PATCH] Upsert failed:", row, error);
      return Response.json(
        { success: false, error: "Failed to save payout settings." },
        { status: 500 }
      );
    }
  }

  const saved: PayoutSettings = {
    platformFeePercent: clampedFee,
    payoutTrigger: payoutTrigger as PayoutTrigger,
    payoutSchedule: payoutSchedule as PayoutSchedule,
  };

  return Response.json({ success: true, settings: saved });
}
