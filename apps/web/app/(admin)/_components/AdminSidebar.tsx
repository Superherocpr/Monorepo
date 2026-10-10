"use client";

/**
 * AdminSidebar: role-filtered navigation sidebar for the admin area.
 * The item list and section grouping live in lib/admin-nav.ts.
 * Desktop: fixed left sidebar 240px wide.
 * Mobile: hidden by default, toggled via hamburger button in AdminTopBar.
 * Used by: app/(admin)/layout.tsx
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { UserRole } from "@/types/users";
import { getVisibleNavItems } from "@/lib/admin-nav";

interface AdminSidebarProps {
  role: UserRole;
}

/**
 * Whether the current URL matches a nav href, query string included.
 * @param href - The nav item's href, optionally with a query string.
 * @param pathname - Current pathname (no query).
 * @param searchParams - Current query parameters.
 * @returns True when the path matches (exact for /admin, prefix otherwise) and
 *          every query parameter in the href has the same value in the URL.
 */
function hrefMatches(
  href: string,
  pathname: string,
  searchParams: URLSearchParams
): boolean {
  const [path, query] = href.split("?");
  const pathMatches = path === "/admin" ? pathname === "/admin" : pathname.startsWith(path);
  if (!pathMatches || !query) return pathMatches;
  return Array.from(new URLSearchParams(query)).every(
    ([key, value]) => searchParams.get(key) === value
  );
}

/** Role-aware navigation sidebar for the admin area. */
export default function AdminSidebar({ role }: AdminSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = getVisibleNavItems(role);

  const navLinks = (
    <nav aria-label="Admin navigation">
      <ul className="space-y-0.5">
        {visibleItems.map((item, index) => {
          // Exact match for dashboard, prefix match for all others. A plain
          // href yields to a more specific sibling with a matching query, so
          // "My Class Sessions" (?mine=1) and "Class Sessions" never both light up.
          const isActive =
            hrefMatches(item.href, pathname, searchParams) &&
            (item.href.includes("?") ||
              !visibleItems.some(
                (other) =>
                  other !== item &&
                  other.href.startsWith(`${item.href}?`) &&
                  hrefMatches(other.href, pathname, searchParams)
              ));

          // Add breathing room when stepping back out of a nested sub-group.
          const prevItem = visibleItems[index - 1];
          const endsNestedGroup = !item.nested && prevItem?.nested;

          return (
            <li key={`${item.label}-${item.href}`}>
              {/* Section header: rendered above the first visible item of each section */}
              {item.sectionHeader && (
                <div className="mt-5 mb-1 border-t border-gray-200">
                  <p className="px-4 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-gray-100">
                    {item.sectionHeader}
                  </p>
                </div>
              )}
              {/* Sub-label: lighter nested grouping within a section */}
              {item.subLabel && (
                <p className="px-4 pt-2 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                  {item.subLabel}
                </p>
              )}
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
                className={[
                  "flex items-center py-2.5 text-sm font-medium rounded-md transition-colors duration-100",
                  item.nested ? "px-6" : "px-4",
                  endsNestedGroup ? "mt-1.5" : "",
                  isActive
                    ? `border-l-4 border-red-600 text-red-600 bg-red-50 ${item.nested ? "pl-5" : "pl-3"}`
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                ].join(" ")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <>
      {/* ── Mobile hamburger button ── */}
      <button
        type="button"
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white border border-gray-200 rounded-md shadow-sm"
        onClick={() => setMobileOpen((prev) => !prev)}
        aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
      >
        <span className="block w-5 h-0.5 bg-gray-700 mb-1" />
        <span className="block w-5 h-0.5 bg-gray-700 mb-1" />
        <span className="block w-5 h-0.5 bg-gray-700" />
      </button>

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={[
          "lg:hidden fixed top-0 left-0 z-50 h-full w-60 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="px-4 py-5 border-b border-gray-100">
          <span className="text-lg font-bold text-gray-900">SuperHeroCPR</span>
          <span className="block text-xs text-gray-400 mt-0.5">Admin</span>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-2">{navLinks}</div>
        <div className="px-4 py-3 border-t border-gray-100">
          <span className="text-[10px] text-gray-400 font-mono select-all">
            {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
          </span>
        </div>
      </aside>

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 bg-white border-r border-gray-200 sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-gray-100">
          <span className="text-lg font-bold text-gray-900">SuperHeroCPR</span>
          <span className="block text-xs text-gray-400 mt-0.5">Admin</span>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-2">{navLinks}</div>
        <div className="px-4 py-3 border-t border-gray-100">
          <span className="text-[10px] text-gray-400 font-mono select-all">
            {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
          </span>
        </div>
      </aside>
    </>
  );
}
