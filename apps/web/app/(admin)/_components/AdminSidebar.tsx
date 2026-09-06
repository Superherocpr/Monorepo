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
  /** Optional section heading rendered above this item as a visual grouping label. */
  sectionLabel?: string;
}

/** Full nav config — items are filtered to the current user's role at render time. */
const NAV_ITEMS: NavItem[] = [
  // ── Top-level ──────────────────────────────────────────────────────────────
  {
    label: "Dashboard",
    href: "/admin",
    roles: ["instructor", "manager", "super_admin", "inspector"],
  },
  // Instructor-only quick-access items (no section label — small flat list)
  { label: "My Class Sessions", href: "/admin/sessions", roles: ["instructor"] },
  { label: "Rollcall", href: "/rollcall", roles: ["instructor"] },

  // ── Operations ─────────────────────────────────────────────────────────────
  {
    label: "Class Requests",
    href: "/admin/class-requests",
    roles: ["manager", "super_admin"],
    sectionLabel: "Operations",
  },
  { label: "Class Sessions", href: "/admin/sessions", roles: ["manager", "super_admin"] },
  { label: "Team Bookings", href: "/admin/team-bookings", roles: ["manager", "super_admin"] },
  { label: "Customers", href: "/admin/customers", roles: ["manager", "super_admin"] },
  {
    label: "Session Approvals",
    href: "/admin/sessions/approvals",
    roles: ["manager", "super_admin"],
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
    label: "Settings",
    href: "/admin/settings",
    roles: ["instructor", "manager", "super_admin"],
  },
  { label: "Staff", href: "/admin/staff", roles: ["super_admin"] },

  // ── Payroll ────────────────────────────────────────────────────────────────
  {
    label: "Payout Settings",
    href: "/admin/profile/payment",
    roles: ["instructor", "super_admin"],
    sectionLabel: "Payroll",
  },
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
              {/* Section label — rendered above the first item in a new group */}
              {item.sectionLabel && (
                <div className="mt-5 mb-1 border-t border-gray-200">
                  <p className="px-4 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-gray-100">
                    {item.sectionLabel}
                  </p>
                </div>
              )}
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
          <span className="text-lg font-bold text-gray-900">SuperHeroCPR</span>
          <span className="block text-xs text-gray-400 mt-0.5">Admin</span>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-2">{navLinks}</div>
      </aside>

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 bg-white border-r border-gray-200 sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-gray-100">
          <span className="text-lg font-bold text-gray-900">SuperHeroCPR</span>
          <span className="block text-xs text-gray-400 mt-0.5">Admin</span>
        </div>
        <div className="flex-1 overflow-y-auto py-4 px-2">{navLinks}</div>
      </aside>
    </>
  );
}
