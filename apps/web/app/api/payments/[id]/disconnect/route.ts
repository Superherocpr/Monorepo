/**
 * DELETE /api/payments/[id]/disconnect
 * Called by: Payment Account page — "Disconnect" confirm button
 * Auth: instructor or super_admin only (own accounts only)
 * Deletes the instructor_payment_accounts record.
 * If the deleted account was active and other accounts remain,
 * auto-promotes the most recently connected account as the new active.
 * Returns { newActiveId } when auto-promotion occurs so the client
 * can update the UI without a full page refresh.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/** Roles permitted to manage their own payment accounts. */
const ALLOWED_ROLES: UserRole[] = ["instructor", "super_admin"];

/**
 * Disconnects a payment account by ID.
 * Ownership is verified — an instructor cannot disconnect another instructor's account.
 * @param request - No body required.
 * @param params - Route params containing the account UUID.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  void request;
  const { id } = await params;
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

  // ── Verify ownership and read current state ────────────────────────────────
  const { data: account } = await supabase
    .from("instructor_payment_accounts")
    .select("id, instructor_id, is_active")
    .eq("id", id)
    .eq("instructor_id", profile.id)
    .single();

  if (!account) {
    return Response.json({ success: false, error: "Account not found." }, { status: 404 });
  }

  // ── Delete the record ──────────────────────────────────────────────────────
  const { error: deleteError } = await supabase
    .from("instructor_payment_accounts")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return Response.json(
      { success: false, error: "Failed to disconnect account." },
      { status: 500 }
    );
  }

  // ── Auto-promote if the deleted account was active ─────────────────────────
  if (!account.is_active) {
    // Was not active — nothing to promote
    return Response.json({ success: true });
  }

  // Find the most recently connected remaining account
  const { data: remaining } = await supabase
    .from("instructor_payment_accounts")
    .select("id")
    .eq("instructor_id", profile.id)
    .order("connected_at", { ascending: false })
    .limit(1);

  if (!remaining || remaining.length === 0) {
    // No remaining accounts — nothing to promote
    return Response.json({ success: true });
  }

  const nextActiveId = remaining[0].id;

  await supabase
    .from("instructor_payment_accounts")
    .update({ is_active: true })
    .eq("id", nextActiveId);

  return Response.json({ success: true, newActiveId: nextActiveId });
}
