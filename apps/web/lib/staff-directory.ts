/**
 * Pure helpers for the internal Staff Directory page (/admin/directory).
 * Used by: app/(admin)/admin/directory/page.tsx
 */

import type { UserRole } from "@/types/users";

/** A staff member as shown on the internal directory page. */
export interface DirectoryMember {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  role: Exclude<UserRole, "customer">;
  /** Short internal role/blurb, e.g. "Billing & Scheduling". Null hides the line. */
  directory_title: string | null;
}

/** A role group as rendered on the directory page. */
export interface DirectoryGroup {
  role: Exclude<UserRole, "customer">;
  label: string;
  members: DirectoryMember[];
}

/** Fixed display order and section labels for grouping the directory by role. */
export const DIRECTORY_ROLE_ORDER: Array<{
  role: Exclude<UserRole, "customer">;
  label: string;
}> = [
  { role: "super_admin", label: "Super Admin" },
  { role: "manager", label: "Manager" },
  { role: "instructor", label: "Instructor" },
  { role: "inspector", label: "Inspector" },
];

/**
 * Groups staff members by role in the fixed order above, sorted by last name
 * within each group. Roles with no members are omitted entirely so an empty
 * section heading never renders.
 * @param members - Staff profiles to group (customers must already be excluded).
 * @returns Ordered groups, each with a display label and its sorted members.
 */
export function groupStaffByRole(members: DirectoryMember[]): DirectoryGroup[] {
  return DIRECTORY_ROLE_ORDER.map(({ role, label }) => ({
    role,
    label,
    members: members
      .filter((member) => member.role === role)
      .slice()
      .sort((a, b) => a.last_name.localeCompare(b.last_name)),
  })).filter((group) => group.members.length > 0);
}
