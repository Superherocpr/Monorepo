/**
 * Staff Directory Page
 * Route: /admin/directory
 * Called by: Admin sidebar nav
 * Auth: instructor, manager, super_admin, inspector (any staff role).
 * Accounts flagged hide_from_directory (test accounts) are omitted.
 * Read-only internal contact list: name, role, phone and email (each with a
 * directory_phone / directory_email override that replaces the real value
 * when set), and the
 * distinct class types each person has completed as lead instructor, for
 * every active staff member, grouped by role. Editing (including each
 * person's directory title/email) happens on /admin/staff, super_admin only.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import {
  groupStaffByRole,
  buildClassesTaughtMap,
  resolveDirectoryEmail,
  resolveDirectoryPhone,
  type DirectoryMember,
} from "@/lib/staff-directory";

export const metadata = { title: "Staff Directory" };

/**
 * Server component: fetches every active (non-customer) staff profile plus
 * the distinct class types each has completed as lead instructor, and
 * renders both grouped by role. getAdminActor() already restricts callers to
 * staff roles, so no further role check is needed here.
 */
export default async function StaffDirectoryPage() {
  const actor = await getAdminActor();
  if (!actor) redirect("/admin");

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, first_name, last_name, email, phone, role, directory_title, directory_email, directory_phone")
    .neq("role", "customer")
    .eq("deactivated", false)
    .eq("archived", false)
    .eq("hide_from_directory", false)
    .order("last_name");

  if (error) {
    console.error("[admin/directory] Failed to fetch staff directory.", error);
  }

  const staffIds = (data ?? []).map((row) => row.id);

  // Classes taught: distinct class types each person has completed as lead
  // instructor. Matches the "sessions taught" definition used elsewhere in
  // the app (Analytics' most-active-instructors chart, the instructor
  // dashboard's pending-grades widget): instructor_id + status = 'completed',
  // no separate approval_status or cancelled_at filter needed since
  // 'completed' and 'cancelled' are mutually exclusive values of the same
  // session_status enum. Assistant-taught sessions are not counted here.
  let classesTaughtMap: Record<string, string[]> = {};
  if (staffIds.length > 0) {
    const { data: sessionRows, error: sessionsError } = await admin
      .from("class_sessions")
      .select("instructor_id, class_types(name)")
      .eq("status", "completed")
      .in("instructor_id", staffIds);

    if (sessionsError) {
      console.error("[admin/directory] Failed to fetch classes taught.", sessionsError);
    } else {
      classesTaughtMap = buildClassesTaughtMap(
        (sessionRows ?? []).map((row) => {
          const classType = row.class_types as unknown as { name: string } | null;
          return {
            instructor_id: row.instructor_id,
            class_type_name: classType?.name ?? null,
          };
        })
      );
    }
  }

  const members: DirectoryMember[] = (data ?? []).map((row) => ({
    ...row,
    classesTaught: classesTaughtMap[row.id] ?? [],
  })) as DirectoryMember[];

  const groups = groupStaffByRole(members);

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
                  {resolveDirectoryPhone(member) && (
                    <a
                      href={`tel:${resolveDirectoryPhone(member)}`}
                      className="block text-red-600 hover:underline"
                    >
                      {resolveDirectoryPhone(member)}
                    </a>
                  )}
                  <a
                    href={`mailto:${resolveDirectoryEmail(member)}`}
                    className="block text-gray-700 hover:underline break-all"
                  >
                    {resolveDirectoryEmail(member)}
                  </a>
                </div>
                {member.classesTaught.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 mb-1.5">Teaches</p>
                    <div className="flex flex-wrap gap-1.5">
                      {member.classesTaught.map((className) => (
                        <span
                          key={className}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
                        >
                          {className}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
