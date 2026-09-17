/**
 * WalkthroughsPanel: renders the "How-To Guides" settings tab content.
 * Lists registered walkthroughs (lib/tours/registry.ts) as links to the page
 * each one runs on, where its TourButton (components/tours/TourButton.tsx)
 * takes over.
 * Used by: SettingsClient.tsx (super_admin), InstructorSettingsClient.tsx
 *          (instructor), ManagerSettingsClient.tsx (manager).
 */

import Link from "next/link";
import { CircleHelp } from "lucide-react";
import type { UserRole } from "@/types/users";
import {
  TOURS,
  TOUR_ROLE_LABELS,
  TOUR_ROLE_ORDER,
  toursForRole,
  toursGroupedByRole,
  type TourDefinition,
} from "@/lib/tours/registry";

interface WalkthroughsPanelProps {
  /** The signed-in user's role: used to filter the list when showAllRoles is false. */
  viewerRole: UserRole;
  /**
   * When true, shows every walkthrough across all roles, grouped under a
   * heading per role (manager and super_admin). When false, shows only the
   * walkthroughs relevant to viewerRole (instructor).
   */
  showAllRoles?: boolean;
}

/** Renders the empty state shown when no walkthroughs match. */
function EmptyState() {
  return (
    <p className="text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-6 text-center">
      No walkthroughs are available yet. Check back soon.
    </p>
  );
}

/** Renders one walkthrough as a card linking to the page it runs on. */
function TourCard({ tour }: { tour: TourDefinition }) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div>
        <p className="font-medium text-gray-900 dark:text-white">{tour.title}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{tour.description}</p>
      </div>
      <Link
        href={tour.href}
        className="shrink-0 inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950 transition-colors"
      >
        Start
      </Link>
    </li>
  );
}

/**
 * Renders the How-To Guides tab: an intro line plus the walkthrough list,
 * either scoped to the viewer's own role or grouped across all roles.
 * @param viewerRole - The signed-in user's role.
 * @param showAllRoles - Whether to show every role's walkthroughs, grouped.
 */
export default function WalkthroughsPanel({
  viewerRole,
  showAllRoles = false,
}: WalkthroughsPanelProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <CircleHelp className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            How-To Guides
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Step-by-step walkthroughs that guide you through common tasks,
            right on the page where you do them.
          </p>
        </div>
      </div>

      {showAllRoles ? (
        <GroupedTourList />
      ) : (
        <OwnRoleTourList viewerRole={viewerRole} />
      )}
    </div>
  );
}

/** Flat list scoped to a single role (the instructor view). */
function OwnRoleTourList({ viewerRole }: { viewerRole: UserRole }) {
  const tours = toursForRole(TOURS, viewerRole);
  if (tours.length === 0) return <EmptyState />;
  return (
    <ul className="space-y-3">
      {tours.map((tour) => (
        <TourCard key={tour.id} tour={tour} />
      ))}
    </ul>
  );
}

/** List grouped under a heading per role (the manager / super_admin view). */
function GroupedTourList() {
  const groups = toursGroupedByRole(TOURS, TOUR_ROLE_ORDER);
  if (groups.length === 0) return <EmptyState />;
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.role}>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            {TOUR_ROLE_LABELS[group.role]}
          </h3>
          <ul className="space-y-3">
            {group.tours.map((tour) => (
              <TourCard key={tour.id} tour={tour} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
