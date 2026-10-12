/**
 * view-as-constants.ts
 * Client-safe auth constants for the "View As" role-switching feature and for
 * role checks that Client Components need to make.
 *
 * Extracted from effective-role.ts so that Client Components (ViewAsSwitcher,
 * the password-reset page) can import these without pulling in next/headers,
 * which is server-only. effective-role.ts re-exports from here to keep a single
 * source of truth.
 */

import type { UserRole } from "@/types/users";

/** Cookie that stores a super admin's temporary view-as role. */
export const VIEW_AS_COOKIE = "admin-view-as";

/** Roles permitted to access the admin area. */
export const STAFF_ROLES: UserRole[] = [
  "instructor",
  "manager",
  "super_admin",
  "inspector",
];

/** Roles a super admin is allowed to view as. Never super_admin or customer. */
export const VIEW_AS_ROLES = ["manager", "instructor", "inspector"] as const;

/** A role value accepted by the view-as switcher. */
export type ViewAsRole = (typeof VIEW_AS_ROLES)[number];

/**
 * Roles that teach classes. Managers and super admins teach too, so every
 * instructor capability (class-day tools, rollcall, session invoices, payouts)
 * is granted to this whole group. Gate instructor features on this constant,
 * never on a literal ["instructor", ...] array: a literal is how managers were
 * silently left out before. tests/unit/lib/role-groups.test.ts enforces it.
 */
export const TEACHING_ROLES = ["instructor", "manager", "super_admin"] as const;

/** A role that teaches classes. */
export type TeachingRole = (typeof TEACHING_ROLES)[number];

/**
 * Whether a role teaches classes and so gets every instructor capability.
 * @param role - The effective role to check.
 * @returns True for instructor, manager, and super_admin.
 */
export function isTeachingRole(role: UserRole): role is TeachingRole {
  return (TEACHING_ROLES as readonly UserRole[]).includes(role);
}

/**
 * Whether a role may use an instructor-scoped tool (grading, CCF, student
 * verification, customer info, additional hours, session invoices) on a record
 * owned by `ownerId`. Super admins may act on any instructor's record. Every
 * other teaching role, managers included, acts only on their own: management
 * access to a session does not extend to grading or invoicing someone else's class.
 * @param role - The actor's effective role.
 * @param actorId - The actor's profile id.
 * @param ownerId - The instructor_id on the session or invoice, or null if unassigned.
 * @returns True when the actor may use the tool on this record.
 */
export function canUseInstructorToolsOn(
  role: UserRole,
  actorId: string,
  ownerId: string | null | undefined
): boolean {
  if (role === "super_admin") return true;
  return isTeachingRole(role) && ownerId === actorId;
}
