/**
 * PATCH /api/payments/set-active
 * Called by: Payment Account page — "Set as Active" button
 * Auth: instructor or super_admin only
 * Sets one payment account as active and marks all others for this instructor as inactive.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/** Roles permitted to manage their own payment accounts. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "super_admin"];

/**
 * Updates the active payment account for the logged-in instructor.
 * Step 1: Set all accounts for this instructor to is_active = false.
 * Step 2: Set the selected account to is_active = true.
 * Only changes accounts belonging to the requesting instructor — ownership verified.
 * @param request - PATCH body: { accountId: string }
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  const body = await request.json();
  const { accountId } = body as { accountId: string };

  if (!accountId) {
    return Response.json({ success: false, error: "accountId is required." }, { status: 400 });
  }

  // ── Verify ownership — the account must belong to this instructor ──────────
  const { data: account } = await supabase
    .from("instructor_payment_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("instructor_id", profile.id)
    .single();

  if (!account) {
    return Response.json({ success: false, error: "Account not found." }, { status: 404 });
  }

  // ── Step 1: Deactivate all accounts for this instructor ────────────────────
  const { error: deactivateError } = await supabase
    .from("instructor_payment_accounts")
    .update({ is_active: false })
    .eq("instructor_id", profile.id);

  if (deactivateError) {
    return Response.json(
      { success: false, error: "Failed to update payment accounts." },
      { status: 500 }
    );
  }

  // ── Step 2: Activate the selected account ─────────────────────────────────
  const { error: activateError } = await supabase
    .from("instructor_payment_accounts")
    .update({ is_active: true })
    .eq("id", accountId);

  if (activateError) {
    return Response.json(
      { success: false, error: "Failed to set active account." },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
