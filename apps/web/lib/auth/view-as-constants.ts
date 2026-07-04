/**
 * view-as-constants.ts
 * Client-safe constants for the "View As" role-switching feature.
 *
 * Extracted from effective-role.ts so that Client Components (ViewAsSwitcher)
 * can import these without pulling in next/headers, which is server-only.
 * effective-role.ts re-exports from here to keep a single source of truth.
 */

/** Cookie that stores a super admin's temporary view-as role. */
export const VIEW_AS_COOKIE = "admin-view-as";

/** Roles a super admin is allowed to view as. Never super_admin or customer. */
export const VIEW_AS_ROLES = ["manager", "instructor", "inspector"] as const;

/** A role value accepted by the view-as switcher. */
export type ViewAsRole = (typeof VIEW_AS_ROLES)[number];
