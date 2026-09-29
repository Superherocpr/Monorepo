"use client";

/**
 * WalkthroughsPanel: renders the "How-To Guides" settings tab content.
 * Lists registered walkthroughs (lib/tours/registry.ts) as links to the page
 * each one runs on, where its TourButton (components/tours/TourButton.tsx)
 * takes over. Filtered to what the viewer can access the same way the Admin
 * Feature Reference filters its bullets (see `canAccessTour` in
 * lib/tours/registry.ts): super_admin sees every walkthrough, every other
 * role sees only the ones tagged for it.
 *
 * Search bar, access-level pill filter, and card styling deliberately match
 * the Admin Feature Reference page (app/(admin)/admin/reference/_components/
 * ReferenceContent.tsx): same ROLE_LABELS/ROLE_CLASSES, same pill-toggle and
 * live-search behavior, so the two lists read as one system.
 *
 * Used by: SettingsClient.tsx (super_admin), InstructorSettingsClient.tsx
 *          (instructor), ManagerSettingsClient.tsx (manager).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CircleHelp, Search, X } from "lucide-react";
import type { UserRole } from "@/types/users";
import { TOURS, toursForRole, type TourDefinition } from "@/lib/tours/registry";
import {
  ROLE_LABELS,
  ROLE_CLASSES,
  type RoleKey,
} from "@/app/(admin)/admin/reference/_components/referenceData";

interface WalkthroughsPanelProps {
  /** The signed-in user's role: determines which walkthroughs are visible. */
  viewerRole: UserRole;
}

/**
 * Maps a walkthrough's tagged roles onto the Reference page's access-level
 * badges. A tour tagged for both instructor and manager is "all" (every
 * staff role), matching one tagged role is that role's own "+super_admin"
 * badge, and super_admin-only (or an empty list) falls back to "super".
 * @param tourRoles - Roles the walkthrough is tagged for.
 */
function badgeRoleKey(tourRoles: UserRole[]): RoleKey {
  const hasInstructor = tourRoles.includes("instructor");
  const hasManager = tourRoles.includes("manager");
  if (hasInstructor && hasManager) return "all";
  if (hasInstructor) return "instructor";
  if (hasManager) return "manager";
  return "super";
}

/**
 * Returns whether a walkthrough matches a lowercase, trimmed search query.
 * @param tour - The walkthrough to test.
 * @param query - Lowercase trimmed search string.
 */
function tourMatches(tour: TourDefinition, query: string): boolean {
  return (
    tour.title.toLowerCase().includes(query) ||
    tour.description.toLowerCase().includes(query)
  );
}

/** Renders one walkthrough as a card linking to the page it runs on. */
function TourCard({ tour, showBadge }: { tour: TourDefinition; showBadge: boolean }) {
  const roleKey = badgeRoleKey(tour.roles);
  return (
    <Link
      href={tour.href}
      className="block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:border-red-300 dark:hover:border-red-700 transition-colors group cursor-pointer"
    >
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 group-hover:bg-red-50/40 dark:group-hover:bg-red-900/10 transition-colors">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          {tour.title}
        </span>
        {showBadge && (
          <span
            className={`ml-auto text-[0.62rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${ROLE_CLASSES[roleKey]}`}
          >
            {ROLE_LABELS[roleKey]}
          </span>
        )}
        <span
          className={`text-red-500 dark:text-red-400 text-sm font-medium leading-none opacity-0 group-hover:opacity-100 transition-opacity ${showBadge ? "" : "ml-auto"}`}
        >
          →
        </span>
      </div>
      <div className="px-5 py-3.5">
        <p className="text-sm text-gray-600 dark:text-gray-400">{tour.description}</p>
      </div>
    </Link>
  );
}

/**
 * Renders the How-To Guides tab: an intro line, an access-level pill filter,
 * a live search bar, and the list of walkthroughs the viewer's role can
 * access, filtered by both.
 * @param viewerRole - The signed-in user's role.
 */
export default function WalkthroughsPanel({ viewerRole }: WalkthroughsPanelProps) {
  const [rawQuery, setRawQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleKey | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = rawQuery.trim().toLowerCase();

  // Every walkthrough this viewer can access, before search/pill filtering.
  const accessibleTours = useMemo(() => toursForRole(TOURS, viewerRole), [viewerRole]);

  // Only show badges/pills when the accessible tours actually span more than
  // one access level: matches the Reference page hiding its own badges when
  // every card would show the same one.
  const visibleRoleKeys = useMemo<RoleKey[]>(() => {
    const seen = new Set<RoleKey>();
    accessibleTours.forEach((t) => seen.add(badgeRoleKey(t.roles)));
    return (Object.keys(ROLE_LABELS) as RoleKey[]).filter((k) => seen.has(k));
  }, [accessibleTours]);

  const filteredTours = useMemo(() => {
    return accessibleTours.filter((tour) => {
      if (roleFilter && badgeRoleKey(tour.roles) !== roleFilter) return false;
      if (query && !tourMatches(tour, query)) return false;
      return true;
    });
  }, [accessibleTours, roleFilter, query]);

  const clearSearch = useCallback(() => {
    setRawQuery("");
    inputRef.current?.focus();
  }, []);

  /** Toggles a role pill: selecting it filters to that access level, re-clicking clears it. */
  const toggleRoleFilter = useCallback((key: RoleKey) => {
    setRoleFilter((prev) => (prev === key ? null : key));
  }, []);

  const showBadges = visibleRoleKeys.length > 1;

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

      {/* Access-level pill filter: only shown when it would distinguish something */}
      {visibleRoleKeys.length > 1 && (
        <div
          className="flex flex-wrap items-center gap-3"
          role="group"
          aria-label="Filter by access level"
        >
          {visibleRoleKeys.map((key) => {
            const isActive = roleFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleRoleFilter(key)}
                aria-pressed={isActive}
                className={[
                  "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all cursor-pointer",
                  ROLE_CLASSES[key],
                  isActive
                    ? "ring-2 ring-offset-1 ring-gray-900 dark:ring-white dark:ring-offset-gray-900"
                    : roleFilter
                    ? "opacity-50 hover:opacity-100"
                    : "hover:opacity-80",
                ].join(" ")}
              >
                {ROLE_LABELS[key]}
              </button>
            );
          })}
          {roleFilter && (
            <button
              type="button"
              onClick={() => setRoleFilter(null)}
              className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline underline-offset-2"
            >
              Reset
            </button>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500 self-center">
            (access level required)
          </span>
        </div>
      )}

      {/* Search bar */}
      <div>
        <div className="relative max-w-lg">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && rawQuery) clearSearch();
            }}
            placeholder="Search walkthroughs…"
            aria-label="Search walkthroughs"
            className={
              "w-full border rounded-lg pl-9 pr-9 py-2.5 text-sm bg-white " +
              "text-gray-900 placeholder:text-gray-400 " +
              "focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent " +
              "dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500 " +
              (query
                ? "border-red-300 dark:border-red-700"
                : "border-gray-300 dark:border-gray-600")
            }
          />
          {rawQuery && (
            <button
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Result count: reflects the search query and/or the active role-filter pill */}
        {(query || roleFilter) && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {filteredTours.length === 0 ? (
              <>
                No results
                {query && <> for &ldquo;{rawQuery.trim()}&rdquo;</>}
                {roleFilter && <> in {ROLE_LABELS[roleFilter]}</>}
              </>
            ) : (
              <>
                {filteredTours.length} of {accessibleTours.length} walkthrough
                {accessibleTours.length !== 1 ? "s" : ""} match
              </>
            )}
          </p>
        )}
      </div>

      {/* List */}
      {filteredTours.length === 0 ? (
        <div className="py-10 text-center border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {accessibleTours.length === 0 ? (
              "No walkthroughs are available yet. Check back soon."
            ) : (
              <>
                No walkthroughs match
                {query && <> &ldquo;{rawQuery.trim()}&rdquo;</>}
                {roleFilter && <> in {ROLE_LABELS[roleFilter]}</>}
              </>
            )}
          </p>
          {(query || roleFilter) && (
            <button
              onClick={() => {
                clearSearch();
                setRoleFilter(null);
              }}
              className="mt-2 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline underline-offset-2"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTours.map((tour) => (
            <TourCard key={tour.id} tour={tour} showBadge={showBadges} />
          ))}
        </div>
      )}
    </div>
  );
}
