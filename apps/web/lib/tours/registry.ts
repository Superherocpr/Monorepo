/**
 * Central manifest of instructor/manager/super_admin guided walkthroughs.
 * Used by: components/tours/WalkthroughsPanel.tsx (the "How-To Guides" settings tab)
 * Each walkthrough is added here once its Driver.js steps are built on its target
 * page (see components/tours/TourButton.tsx); this file only holds the discovery
 * metadata shown in the list, not the step definitions themselves.
 */

import type { UserRole } from "@/types/users";

/** Discovery metadata for one guided walkthrough. */
export interface TourDefinition {
  /** Stable identifier for this walkthrough. */
  id: string;
  /** Short, plain-English name shown in the How-To Guides list. */
  title: string;
  /** One-sentence description of what the walkthrough accomplishes. */
  description: string;
  /** Roles this walkthrough is relevant to. */
  roles: UserRole[];
  /** Page the walkthrough runs on; the list links here to start it. */
  href: string;
}

/** Every registered walkthrough. Add an entry here once a tour's steps ship. */
export const TOURS: TourDefinition[] = [
  {
    id: "create-session",
    title: "Submit a Class Session for Approval",
    description:
      "Walks you through creating a new class session, step by step, from picking a class type to sending it in for approval.",
    roles: ["instructor"],
    href: "/admin/sessions/new?tour=create-session",
  },
  {
    id: "team-booking",
    title: "Create a Team or Corporate Booking",
    description:
      "Walks you through setting up a private class for a company, from entering their contact details to sending the signup link.",
    roles: ["instructor", "manager", "super_admin"],
    href: "/admin/sessions/new?team=1&tour=team-booking",
  },
];

/** Human-readable label for each role, used to group the "all roles" view. */
export const TOUR_ROLE_LABELS: Record<UserRole, string> = {
  customer: "Customer",
  instructor: "Instructor",
  manager: "Manager",
  super_admin: "Super Admin",
  inspector: "Inspector",
};

/**
 * Display order for role groups in the "all roles" view.
 * Customers are excluded elsewhere: they have no admin-area walkthroughs.
 */
export const TOUR_ROLE_ORDER: UserRole[] = [
  "instructor",
  "manager",
  "super_admin",
  "inspector",
];

/**
 * Returns every walkthrough relevant to a single role, in list order.
 * @param tours - Walkthroughs to filter, normally the TOURS registry.
 * @param role - The viewer's role.
 */
export function toursForRole(tours: TourDefinition[], role: UserRole): TourDefinition[] {
  return tours.filter((tour) => tour.roles.includes(role));
}

/** One role group and its walkthroughs, for the "all roles" admin view. */
export interface TourRoleGroup {
  role: UserRole;
  tours: TourDefinition[];
}

/**
 * Groups walkthroughs by role for the "all roles" admin view. Roles with no
 * matching walkthroughs are omitted rather than shown empty.
 * @param tours - Walkthroughs to group, normally the TOURS registry.
 * @param roles - Roles to include, in the desired display order.
 */
export function toursGroupedByRole(tours: TourDefinition[], roles: UserRole[]): TourRoleGroup[] {
  return roles
    .map((role) => ({ role, tours: toursForRole(tours, role) }))
    .filter((group) => group.tours.length > 0);
}
