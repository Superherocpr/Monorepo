"use client";

/**
 * AdminSidebar: role-filtered navigation sidebar for the admin area.
 * Desktop: fixed left sidebar 240px wide.
 * Mobile: hidden by default, toggled via hamburger button in AdminTopBar.
 * Used by: app/(admin)/layout.tsx
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { UserRole } from "@/types/users";
import { TEACHING_ROLES } from "@/lib/auth/view-as-constants";

interface NavItem {
  label: string;
  /** Link target. May carry a query string (e.g. "?mine=1"); active-state matching honors it. */
  href: string;
  roles: readonly UserRole[];
  /** Optional section heading rendered above this item as a visual grouping label. */
  sectionLabel?: string;
  /** Optional sub-group label rendered above this item, nested within a section. */
  subLabel?: string;
  /** When true, indents this item to show it belongs to the preceding subLabel group. */
  nested?: boolean;
}

/** Full nav config: items are filtered to the current user's role at render time. */
const NAV_ITEMS: NavItem[] = [
  // ── Top-level ──────────────────────────────────────────────────────────────
  {
    label: "Dashboard",
    href: "/admin",
    roles: ["instructor", "manager", "super_admin", "inspector"],
  },
  // Teaching quick-access items (no section label: small flat list). Every
  // teaching role gets these. An instructor's sessions list is already scoped
  // to their own classes; managers and super admins see every class there, so
  // their link carries ?mine=1 to filter it down to the classes they teach.
  { label: "My Class Sessions", href: "/admin/sessions", roles: ["instructor"] },
  {
    label: "My Class Sessions",
    href: "/admin/sessions?mine=1",
    roles: ["manager", "super_admin"],
  },
  { label: "Rollcall", href: "/rollcall", roles: TEACHING_ROLES },

  // ── Operations ─────────────────────────────────────────────────────────────
  {
    label: "Class Sessions",
    href: "/admin/sessions",
    roles: ["manager", "super_admin"],
    sectionLabel: "Operations",
  },
  { label: "Customers", href: "/admin/customers", roles: ["manager", "super_admin"] },
  {
    label: "Customer Requests",
    href: "/admin/class-requests",
    roles: ["manager", "super_admin"],
    subLabel: "Requests",
    nested: true,
  },
  {
    label: "Instructor Requests",
    href: "/admin/sessions/approvals",
    roles: ["manager", "super_admin"],
    nested: true,
  },

  // ── Financial ──────────────────────────────────────────────────────────────
  {
    label: "Invoices",
    href: "/admin/invoices",
    roles: ["manager", "super_admin"],
    sectionLabel: "Financial",
  },
  { label: "Payments", href: "/admin/payments", roles: ["manager", "super_admin"] },
  { label: "Payouts", href: "/admin/payouts", roles: ["super_admin"] },
  { label: "Promo Codes", href: "/admin/promo-codes", roles: ["super_admin"] },

  // ── Engagement ─────────────────────────────────────────────────────────────
  {
    label: "Blog",
    href: "/admin/blog",
    roles: ["super_admin"],
    sectionLabel: "Engagement",
  },
  {
    label: "Certifications",
    href: "/admin/certifications",
    roles: ["super_admin"],
  },
  { label: "Contact", href: "/admin/contact", roles: ["manager", "super_admin"] },
  { label: "Merch", href: "/admin/merch", roles: ["super_admin"] },
  { label: "Orders", href: "/admin/orders", roles: ["super_admin"] },

  // ── Management ─────────────────────────────────────────────────────────────
  {
    label: "Analytics",
    href: "/admin/analytics",
    roles: ["super_admin"],
    sectionLabel: "Management",
  },
  { label: "Archived Accounts", href: "/admin/archived", roles: ["super_admin"] },
  {
    label: "Directory",
    href: "/admin/directory",
    roles: ["instructor", "manager", "super_admin", "inspector"],
  },
  {
    label: "Settings",
    href: "/admin/settings",
    roles: ["instructor", "manager", "super_admin"],
  },
  { label: "Staff", href: "/admin/staff", roles: ["super_admin"] },

  // ── Payroll ────────────────────────────────────────────────────────────────
  {
    label: "Payout Settings",
    href: "/admin/profile/payment",
    roles: TEACHING_ROLES,
    sectionLabel: "Payroll",
  },
];

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

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

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
              {/* Section label: rendered above the first item in a new group */}
              {item.sectionLabel && (
                <div className="mt-5 mb-1 border-t border-gray-200">
                  <p className="px-4 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-gray-100">
                    {item.sectionLabel}
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
