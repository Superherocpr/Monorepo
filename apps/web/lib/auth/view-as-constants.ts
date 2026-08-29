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
