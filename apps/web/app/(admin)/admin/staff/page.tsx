/**
 * Staff Management Page
 * Route: /admin/staff
 * Called by: Admin sidebar nav
 * Auth: super_admin only — all other roles are redirected to /admin
 * Fetches all staff profiles (active and deactivated) and passes them to the
 * client component for filtering and interactive actions.
 */

import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { OWNER_EMAILS } from "@/lib/constants";
import StaffManagement from "./_components/StaffManagement";
import type { UserRole } from "@/types/users";

export const metadata = { title: "Staff Management" };

/**
 * Server component — fetches all staff members and current user info.
 * Redirects non-super-admins back to /admin.
 */
export default async function StaffPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/staff");

  // Role check — super admin only
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role as UserRole) !== "super_admin") {
    redirect("/admin");
  }

  // Fetch all staff via the admin client so super admins can always see every
  // staff profile regardless of RLS policy variations across environments.
  const adminSupabase = await createAdminClient();
  const { data: rawStaffMembers, error: staffError } = await adminSupabase
    .from("profiles")
    .select(
      "id, first_name, last_name, email, phone, role, deactivated, deactivated_at, created_at"
    )
    .neq("role", "customer")
    .order("role")
    .order("last_name");

  // Some older local schemas may not yet include phone/deactivated columns.
  // If that query fails, fall back to a legacy column set and synthesize defaults.
  let staffMembers = rawStaffMembers ?? [];
  if (staffError) {
    console.error("[admin/staff] Failed to fetch staff with full column set:", staffError);
    const { data: legacyStaffMembers } = await adminSupabase
      .from("profiles")
      .select("id, first_name, last_name, email, role, created_at")
      .neq("role", "customer")
      .order("role")
      .order("last_name");

    staffMembers = (legacyStaffMembers ?? []).map((row) => ({
      ...row,
      phone: null,
      deactivated: false,
      deactivated_at: null,
    }));
  }

  return (
    <StaffManagement
      staffMembers={staffMembers ?? []}
      ownerEmails={OWNER_EMAILS}
      currentUserId={user.id}
    />
  );
}
