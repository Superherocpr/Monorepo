"use client";

/**
 * AdminSidebar — role-filtered navigation sidebar for the admin area.
 * Desktop: fixed left sidebar 240px wide.
 * Mobile: hidden by default, toggled via hamburger button in AdminTopBar.
 * Used by: app/(admin)/layout.tsx
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/types/users";

interface NavItem {
  label: string;
  href: string;
  roles: UserRole[];
}

/** Full nav config — items are filtered to the current user's role at render time. */
const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/admin",
    roles: ["instructor", "manager", "super_admin", "inspector"],
  },
  {
    label: "My Classes",
    href: "/admin/sessions",
    roles: ["instructor"],
  },
  {
    label: "Grading",
    href: "/admin/sessions",
    roles: ["instructor"],
  },
  {
    label: "Invoices",
    href: "/admin/invoices",
    roles: ["instructor", "manager", "super_admin"],
  },
  {
    label: "Rollcall",
    href: "/rollcall",
    roles: ["instructor"],
  },
  {
    label: "Classes",
    href: "/admin/sessions",
    roles: ["manager", "super_admin"],
  },
  {
    label: "Approvals",
    href: "/admin/sessions/approvals",
    roles: ["manager", "super_admin"],
  },
  {
    label: "Customers",
    href: "/admin/customers",
    roles: ["manager", "super_admin"],
  },
  {
    label: "Payments",
    href: "/admin/payments",
    roles: ["manager", "super_admin"],
  },
  {
    label: "Contact",
    href: "/admin/contact",
    roles: ["manager", "super_admin"],
  },
  {
    label: "Locations",
    href: "/admin/locations",
    roles: ["manager", "super_admin"],
  },
  {
    label: "Certifications",
    href: "/admin/certifications",
    roles: ["super_admin"],
  },
  { label: "Merch", href: "/admin/merch", roles: ["super_admin"] },
  { label: "Orders", href: "/admin/orders", roles: ["super_admin"] },
  { label: "Staff", href: "/admin/staff", roles: ["super_admin"] },
  { label: "Settings", href: "/admin/settings", roles: ["super_admin"] },
  {
    label: "Archived Accounts",
    href: "/admin/archived",
    roles: ["super_admin"],
  },
  { label: "Analytics", href: "/admin/analytics", roles: ["super_admin"] },
];

interface AdminSidebarProps {
  role: UserRole;
}

/** Role-aware navigation sidebar for the admin area. */
export default function AdminSidebar({ role }: AdminSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(role));

  const navLinks = (
    <nav aria-label="Admin navigation">
      <ul className="space-y-0.5">
        {visibleItems.map((item) => {
          // Exact match for dashboard, prefix match for all others
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);

          return (
            <li key={`${item.label}-${item.href}`}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
                className={[
                  "flex items-center px-4 py-2.5 text-sm font-medium rounded-md transition-colors duration-100",
                  isActive
                    ? "border-l-4 border-red-600 text-red-600 bg-red-50 pl-3"
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
          <span className="text-lg font-bold text-gray-900">Superhero CPR</span>
          <span className="block text-xs text-gray-400 mt-0.5">Admin</span>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-2">{navLinks}</div>
      </aside>

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 bg-white border-r border-gray-200 min-h-screen">
        <div className="px-4 py-5 border-b border-gray-100">
          <span className="text-lg font-bold text-gray-900">Superhero CPR</span>
          <span className="block text-xs text-gray-400 mt-0.5">Admin</span>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-2">{navLinks}</div>
      </aside>
    </>
  );
}
