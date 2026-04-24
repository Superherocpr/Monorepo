/**
 * POST /api/customers/restore
 * Called by: Admin Archived Accounts page — "Restore Account" confirm button
 * Auth: super_admin only
 * Clears the archived flag on a customer profile. The Supabase auth account is
 * never deleted during archiving, so the customer can log in immediately after restore.
 */

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";

/**
 * Restores an archived customer account by clearing archived + archived_at.
 * Only operates on profiles with role=customer as a safety guard.
 * @param request - POST body: { customerId: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || (actor.role as UserRole) !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Parse and validate body ────────────────────────────────────────────────
  const body = await request.json();
  const { customerId } = body as { customerId: string };

  if (!customerId) {
    return Response.json(
      { success: false, error: "customerId is required." },
      { status: 400 }
    );
  }

  // ── Restore — safety check ensures we only restore customer-role profiles ──
  const { error } = await supabase
    .from("profiles")
    .update({
      archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId)
    // Prevents this endpoint from being misused to restore staff accounts —
    // those are managed separately via the deactivated flag on /admin/staff
    .eq("role", "customer");

  if (error) {
    return Response.json(
      { success: false, error: "Failed to restore account." },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
