/**
 * Payout trigger helper.
 * Used by booking confirmation and invoice mark-paid routes to fire an
 * automatic payout batch when the system is in "immediate" trigger mode.
 *
 * Does NOT block the calling request — payout failures are logged but do not
 * cause the booking or invoice operation to fail.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reads the payout_trigger system_settings value.
 * @param supabase - Supabase client with access to system_settings.
 * @returns The current trigger mode, or "manual" if unset.
 */
async function getPayoutTrigger(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>
): Promise<string> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "payout_trigger")
    .maybeSingle();

  return (data as { value?: string } | null)?.value ?? "manual";
}

/**
 * Fires a non-blocking payout batch request if the system is in "immediate" mode.
 *
 * Reads the payout_trigger setting. If it is "immediate", calls
 * POST /api/payouts/create using the CRON_SECRET bearer token so the route
 * can run without a user session. The fetch is intentionally not awaited —
 * the payout happens asynchronously and failure does not surface to the customer.
 *
 * Safe to call after every booking confirmation and invoice mark-paid.
 *
 * @param supabase - Supabase client used to read system_settings.
 */
export async function maybeTriggerImmediatePayout(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>
): Promise<void> {
  try {
    const trigger = await getPayoutTrigger(supabase);
    if (trigger !== "immediate") return;

    const cronSecret = process.env.CRON_SECRET;
    const appUrl = process.env.NEXT_PUBLIC_BASE_URL;

    if (!cronSecret || !appUrl) {
      // Missing env vars — log and skip rather than crashing
      console.warn(
        "[payout-trigger] Cannot fire immediate payout: CRON_SECRET or NEXT_PUBLIC_BASE_URL not set."
      );
      return;
    }

    // Fire-and-forget: do not await, do not let errors bubble up to the caller.
    // The payout route will log its own errors internally.
    fetch(`${appUrl}/api/payouts/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // X-Payout-Source tells the route this is an automated trigger,
        // not a manual admin click. The route uses CRON_SECRET for auth.
        Authorization: `Bearer ${cronSecret}`,
        "X-Payout-Source": "immediate",
      },
      body: "{}",
    }).catch((err: unknown) => {
      console.error("[payout-trigger] Immediate payout fetch failed (non-fatal):", err);
    });
  } catch (err) {
    // Never let trigger errors surface to the booking/invoice flow.
    console.error("[payout-trigger] Unexpected error (non-fatal):", err);
  }
}
