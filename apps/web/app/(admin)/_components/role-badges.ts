/**
 * Shared role badge display maps for the admin chrome.
 * Extracted from AdminTopBar so ViewAsSwitcher and ViewAsBanner can reuse them
 * without circular imports. Used by: AdminTopBar, ViewAsSwitcher, ViewAsBanner.
 */

import type { UserRole } from "@/types/users";

/** Human-readable labels for each staff role. */
export const ROLE_LABELS: Record<UserRole, string> = {
  customer: "Customer",
  instructor: "Instructor",
  manager: "Manager",
  super_admin: "Super Admin",
  inspector: "Inspector",
};

/** Tailwind color classes for each role badge. */
export const ROLE_COLORS: Record<UserRole, string> = {
  customer: "bg-gray-100 text-gray-600",
  instructor: "bg-blue-100 text-blue-700",
  manager: "bg-amber-100 text-amber-700",
  super_admin: "bg-red-100 text-red-700",
  inspector: "bg-green-100 text-green-700",
};
