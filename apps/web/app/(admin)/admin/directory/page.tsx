/**
 * Staff Directory Page
 * Route: /admin/directory
 * Called by: Admin sidebar nav
 * Auth: instructor, manager, super_admin, inspector (any staff role).
 * Read-only internal contact list: name, role, phone, and email for every
 * active staff member, grouped by role. Editing (including each person's
 * directory title) happens on /admin/staff, super_admin only.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import { groupStaffByRole, type DirectoryMember } from "@/lib/staff-directory";

export const metadata = { title: "Staff Directory" };

/**
 * Server component: fetches every active (non-customer) staff profile and
 * renders it grouped by role. getAdminActor() already restricts callers to
 * staff roles, so no further role check is needed here.
 */
export default async function StaffDirectoryPage() {
  const actor = await getAdminActor();
  if (!actor) redirect("/admin");

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, first_name, last_name, email, phone, role, directory_title")
    .neq("role", "customer")
    .eq("deactivated", false)
    .eq("archived", false)
    .order("last_name");

  if (error) {
    console.error("[admin/directory] Failed to fetch staff directory.", error);
  }

  const groups = groupStaffByRole((data ?? []) as DirectoryMember[]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Staff Directory</h1>
        <p className="text-sm text-gray-500 mt-1">
          Contact info for everyone on staff.
        </p>
      </div>

      {groups.length === 0 && (
        <p className="text-sm text-gray-500">No staff members to show.</p>
      )}

      {groups.map((group) => (
        <div key={group.role}>
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
            {group.label}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {group.members.map((member) => (
              <div
                key={member.id}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <p className="font-semibold text-gray-900">
                  {member.first_name} {member.last_name}
                </p>
                {member.directory_title && (
                  <p className="text-sm text-gray-500 mt-0.5">{member.directory_title}</p>
                )}
                <div className="mt-3 space-y-1 text-sm">
                  {member.phone && (
                    <a
                      href={`tel:${member.phone}`}
                      className="block text-red-600 hover:underline"
                    >
                      {member.phone}
                    </a>
                  )}
                  <a
                    href={`mailto:${member.email}`}
                    className="block text-gray-700 hover:underline break-all"
                  >
                    {member.email}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
