/**
 * Layout for all /admin/* routes.
 * Handles auth guard: redirects unauthenticated users and non-staff to /.
 * Provides the shared sidebar + top bar chrome for all admin pages.
 * Used by: every page under app/(admin)/
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminSidebar from "./_components/AdminSidebar";
import AdminTopBar from "./_components/AdminTopBar";
import type { UserRole } from "@/types/users";

/** Roles permitted to access the admin area. */
const STAFF_ROLES: UserRole[] = [
  "instructor",
  "manager",
  "super_admin",
  "inspector",
];

/** Wraps all /admin/* pages with auth guard, sidebar, and top bar. */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, role, archived")
    .eq("id", user.id)
    .single();

  // Redirect archived staff or non-staff users
  if (
    !profile ||
    profile.archived ||
    !STAFF_ROLES.includes(profile.role as AdminRole)
  ) {
    redirect("/");
  }

  const role = profile.role as UserRole;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <AdminSidebar role={role} />
      <div className="flex flex-col flex-1 min-w-0">
        <AdminTopBar
          firstName={profile.first_name}
          lastName={profile.last_name}
          role={role}
        />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
