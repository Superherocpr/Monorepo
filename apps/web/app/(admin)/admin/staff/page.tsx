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
import type { StaffMember } from "./_components/StaffManagement";

export const metadata = { title: "Staff Management" };

/**
 * Server component — fetches all staff members and current user info.
 * Redirects non-super-admins back to /admin.
 */
export default async function StaffPage() {
  const supabase = await createClient();
  const admin = await createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin/staff");

  // Role check — super admin only
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role as UserRole) !== "super_admin") {
    redirect("/admin");
  }

  // Try a full-column staff query first. If local schema is older, retry with
  // a legacy column set and synthesize defaults used by the UI.
  const fullSelect =
    "id, first_name, last_name, email, phone, role, deactivated, deactivated_at, created_at, bio_photo, bio_description, bio_credentials, bio_published, bio_years_experience, bio_students_trained";
  const legacySelect = "id, first_name, last_name, email, role, created_at";

  let staffMembers: StaffMember[] = [];
  const adminSupabase = await createAdminClient();
  const { data: adminFull, error: adminFullError } = await adminSupabase
    .from("profiles")
    .select(fullSelect)
    .neq("role", "customer")
    .order("role")
    .order("last_name");

  if (!adminFullError) {
    staffMembers = (adminFull ?? []) as StaffMember[];
  } else {
    const { data: adminLegacy, error: adminLegacyError } = await adminSupabase
      .from("profiles")
      .select(legacySelect)
      .neq("role", "customer")
      .order("role")
      .order("last_name");

    if (!adminLegacyError) {
      staffMembers = (adminLegacy ?? []).map((row) => ({
        ...row,
        phone: null,
        deactivated: false,
        deactivated_at: null,
        bio_photo: null,
        bio_description: null,
        bio_credentials: null,
        bio_published: false,
        bio_years_experience: null,
        bio_students_trained: null,
      })) as StaffMember[];
    } else {
      console.error("[admin/staff] Failed to fetch staff members.", {
        adminFullError,
        adminLegacyError,
      });
    }
  }

  return (
    <StaffManagement
      staffMembers={staffMembers ?? []}
      ownerEmails={OWNER_EMAILS}
      currentUserId={user.id}
    />
  );
}
