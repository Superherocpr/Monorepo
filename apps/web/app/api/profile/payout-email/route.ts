/**
 * PATCH /api/profile/payout-email
 * Called by: /admin/profile/payment payout settings form
 * Auth: instructor or super_admin only
 * Saves the PayPal email address where instructor payouts should be sent.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/** Roles permitted to save payout email settings. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "super_admin"];

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Returns true when a value is a valid email address for PayPal payouts. */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Saves the current instructor's PayPal payout email.
 * Side effects: updates profiles.paypal_payout_email for the authenticated user.
 * @param request - PATCH request with JSON body { paypalPayoutEmail }.
 */
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body) || typeof body.paypalPayoutEmail !== "string") {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const paypalPayoutEmail = body.paypalPayoutEmail.trim().toLowerCase();
  if (!paypalPayoutEmail || !isValidEmail(paypalPayoutEmail)) {
    return Response.json({ success: false, error: "Enter a valid PayPal email address." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, archived, deactivated")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.archived ||
    profile.deactivated ||
    !ALLOWED_ROLES.includes(profile.role as UserRole)
  ) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ paypal_payout_email: paypalPayoutEmail })
    .eq("id", profile.id);

  if (error) {
    console.error("[profile/payout-email] Update failed:", error);
    return Response.json({ success: false, error: "Failed to save payout email." }, { status: 500 });
  }

  return Response.json({ success: true, paypalPayoutEmail });
}
