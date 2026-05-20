/**
 * DELETE /api/staff/[id]/delete
 * Called by: Admin Staff Management — Delete action (after inline confirmation)
 * Auth: super_admin only
 * Permanently removes a staff member's profile and Supabase auth account.
 *
 * Blocked if:
 *   - The target is an owner email (immutable via this route)
 *   - The actor is targeting their own account
 *   - The staff member has any class sessions (would orphan instructor records)
 *   - The staff member has any invoices (NOT NULL FK, no cascade)
 *
 * Before deleting the profile, the route cleans up:
 *   - Nulls bookings.created_by / cancelled_by and payments.logged_by
 *   - Deletes invoice_activity_log, contact_replies, stock_adjustments, certifications
 *
 * The profile is deleted first. If the auth deletion subsequently fails the
 * profile row is gone but the login account is orphaned — in practice this
 * should never happen with the service role key, but the error is logged.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { OWNER_EMAILS } from "@/lib/constants";

/**
 * Permanently deletes a staff member's account.
 * @param request - No body required.
 * @param params - Route params containing the target staff member's profile ID.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  void request;
  const { id: targetId } = await params;
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || actor.role !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Cannot delete yourself ────────────────────────────────────────────────
  if (targetId === user.id) {
    return Response.json(
      { success: false, error: "You cannot delete your own account." },
      { status: 400 }
    );
  }

  // ── Owner protection ───────────────────────────────────────────────────────
  const { data: target } = await supabase
    .from("profiles")
    .select("email, first_name, last_name, role")
    .eq("id", targetId)
    .single();

  if (!target) {
    return Response.json(
      { success: false, error: "Staff member not found." },
      { status: 404 }
    );
  }

  if (OWNER_EMAILS.includes(target.email.toLowerCase())) {
    return Response.json(
      { success: false, error: "The owner account cannot be deleted." },
      { status: 403 }
    );
  }

  // Ensure we're only deleting staff profiles (not customers)
  const staffRoles = ["instructor", "manager", "super_admin", "inspector"];
  if (!staffRoles.includes(target.role)) {
    return Response.json(
      { success: false, error: "Target is not a staff member." },
      { status: 400 }
    );
  }

  // ── Dependency check — block if the member has class sessions ─────────────
  // Class sessions reference instructor_id → profiles(id). Deleting a profile
  // with existing sessions would either violate the FK or orphan those sessions.
  // Admins should deactivate instead of deleting accounts with session history.
  const { count: sessionCount } = await supabase
    .from("class_sessions")
    .select("id", { count: "exact", head: true })
    .eq("instructor_id", targetId);

  if (sessionCount && sessionCount > 0) {
    return Response.json(
      {
        success: false,
        error:
          `${target.first_name} has ${sessionCount} class session${sessionCount === 1 ? "" : "s"} on record. ` +
          "Accounts with session history cannot be deleted — deactivate the account instead.",
      },
      { status: 409 }
    );
  }

  // ── Dependency check — block if the member has issued invoices ─────────────
  // Invoices reference instructor_id with a NOT NULL constraint and no CASCADE.
  const { count: invoiceCount } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("instructor_id", targetId);

  if (invoiceCount && invoiceCount > 0) {
    return Response.json(
      {
        success: false,
        error:
          `${target.first_name} has ${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"} on record. ` +
          "Accounts with invoices cannot be deleted — deactivate the account instead.",
      },
      { status: 409 }
    );
  }

  // ── Null out nullable FK columns that reference this profile ───────────────
  // bookings.created_by and cancelled_by are nullable — clearing them preserves
  // the booking record while removing the reference to the deleted account.
  // payments.logged_by is likewise nullable.
  await Promise.all([
    supabase.from("bookings").update({ created_by: null }).eq("created_by", targetId),
    supabase.from("bookings").update({ cancelled_by: null }).eq("cancelled_by", targetId),
    supabase.from("payments").update({ logged_by: null }).eq("logged_by", targetId),
  ]);

  // ── Delete audit/log rows that reference this profile ─────────────────────
  // These are audit trail records (NOT NULL FKs) that would block the profile
  // delete. Since the admin is choosing to fully erase this account, removing
  // these records is the appropriate action.
  await Promise.all([
    supabase.from("invoice_activity_log").delete().eq("actor_id", targetId),
    supabase.from("contact_replies").delete().eq("sent_by", targetId),
    supabase.from("stock_adjustments").delete().eq("adjusted_by", targetId),
    supabase.from("certifications").delete().eq("customer_id", targetId),
  ]);

  // ── Delete the profile ─────────────────────────────────────────────────────
  // The profile must be deleted before the auth user. If Supabase's FK is
  // ON DELETE CASCADE (auth.users → profiles), deleting the auth user would
  // also delete the profile — but deleting the profile first is the safe
  // order since we control it explicitly.
  const { error: profileDeleteError } = await supabase
    .from("profiles")
    .delete()
    .eq("id", targetId);

  if (profileDeleteError) {
    // If this fails it may be due to other FK references not yet handled by the check above.
    console.error("[staff/delete] profile delete failed:", profileDeleteError);
    return Response.json(
      {
        success: false,
        error:
          "Cannot delete this account — it has associated records. Deactivate the account instead.",
      },
      { status: 409 }
    );
  }

  // ── Delete the auth user ───────────────────────────────────────────────────
  const adminClient = await createAdminClient();
  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(targetId);

  if (authDeleteError) {
    // Profile is already gone but the login account remains. Log for manual cleanup.
    console.error(
      `[staff/delete] auth.admin.deleteUser failed for ${targetId} — profile already deleted. Manual cleanup required.`,
      authDeleteError
    );
    // Return success from the admin's perspective — the profile is gone and they
    // can no longer log in once the session expires. The orphaned auth row is
    // an infrastructure concern logged above.
  }

  return Response.json({ success: true });
}
