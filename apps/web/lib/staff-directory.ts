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
  /** Public-facing contact email override. Null falls back to `email`. Never the real login address to hide. */
  directory_email: string | null;
  /** Phone override shown in place of `phone`. Null or blank falls back to `phone`. */
  directory_phone: string | null;
  /** Distinct class type names this person has completed as lead instructor, alphabetized. Empty if none. */
  classesTaught: string[];
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

/**
 * Resolves the email shown on a directory card: the override when one is
 * set, otherwise the real profile email.
 * @param member - The staff member whose display email is needed.
 * @returns `directory_email` if set, else `email`.
 */
export function resolveDirectoryEmail(member: DirectoryMember): string {
  return member.directory_email ?? member.email;
}

/**
 * Resolves the phone shown on a directory card: the override when one is set,
 * otherwise the real profile phone. Blank strings count as unset, because
 * migration 0064 backfilled missing profile phones to '' rather than null.
 * @param member - The staff member whose display phone is needed.
 * @returns The phone to show, or null when neither value has content.
 */
export function resolveDirectoryPhone(member: DirectoryMember): string | null {
  const override = member.directory_phone?.trim();
  if (override) return override;
  const real = member.phone?.trim();
  return real || null;
}

/** One completed session row, as needed to build the classes-taught map. */
export interface CompletedSessionRow {
  instructor_id: string | null;
  /** Class type name, e.g. "BLS". Null if the class type lookup failed. */
  class_type_name: string | null;
}

/**
 * Builds a map of instructor id to the distinct, alphabetized class type
 * names they have completed as lead instructor. Rows with a null
 * instructor_id or class_type_name are skipped (an orphaned or mid-lookup
 * row should not render as a class taught by nobody).
 * @param rows - Completed class_sessions rows joined to their class type name.
 * @returns Map keyed by instructor id, each value a deduped, sorted name list.
 */
export function buildClassesTaughtMap(
  rows: CompletedSessionRow[]
): Record<string, string[]> {
  const sets: Record<string, Set<string>> = {};

  for (const row of rows) {
    if (!row.instructor_id || !row.class_type_name) continue;
    (sets[row.instructor_id] ??= new Set()).add(row.class_type_name);
  }

  const result: Record<string, string[]> = {};
  for (const [instructorId, names] of Object.entries(sets)) {
    result[instructorId] = Array.from(names).sort((a, b) => a.localeCompare(b));
  }
  return result;
}
