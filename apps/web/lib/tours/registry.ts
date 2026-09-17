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
    roles: ["instructor", "manager", "super_admin"],
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

/**
 * Returns whether a viewer can access a walkthrough tagged for the given
 * roles. Mirrors the Admin Feature Reference's access model (see `canAccess`
 * in app/(admin)/admin/reference/_components/ReferenceContent.tsx):
 * super_admin can access everything; every other role only sees walkthroughs
 * explicitly tagged for it.
 * @param tourRoles - Roles the walkthrough is tagged for.
 * @param viewerRole - The signed-in user's role.
 */
export function canAccessTour(tourRoles: UserRole[], viewerRole: UserRole): boolean {
  if (viewerRole === "super_admin") return true;
  return tourRoles.includes(viewerRole);
}

/**
 * Returns every walkthrough a role can access, in registry order.
 * @param tours - Walkthroughs to filter, normally the TOURS registry.
 * @param role - The viewer's role.
 */
export function toursForRole(tours: TourDefinition[], role: UserRole): TourDefinition[] {
  return tours.filter((tour) => canAccessTour(tour.roles, role));
}
