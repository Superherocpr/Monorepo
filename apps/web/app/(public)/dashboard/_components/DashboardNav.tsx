"use client";

/**
 * Dashboard navigation component — shared sidebar/tab bar for all /dashboard/* routes.
 * Desktop: vertical sidebar on the left. Mobile: horizontal scrolling tab bar at top.
 * Used by: app/(public)/dashboard/layout.tsx
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Award,
  ShoppingBag,
  Settings,
} from "lucide-react";

const navLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/bookings", label: "My Bookings", icon: Calendar },
  { href: "/dashboard/certifications", label: "My Certifications", icon: Award },
  { href: "/dashboard/orders", label: "My Orders", icon: ShoppingBag },
  { href: "/dashboard/settings", label: "Account Settings", icon: Settings },
];

/** Renders the vertical sidebar (desktop) and horizontal tab bar (mobile) for the customer dashboard. */
export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile: horizontal scrolling tab bar */}
      <nav
        className="lg:hidden bg-white border-b border-gray-200 overflow-x-auto"
        aria-label="Dashboard navigation"
      >
        <div className="flex min-w-max px-4">
          {navLinks.map(({ href, label, icon: Icon }) => {
            // Exact match for /dashboard; prefix match for sub-routes
            const isActive =
              href === "/dashboard" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={[
                  "flex items-center gap-1.5 px-3 py-3.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors duration-150",
                  isActive
                    ? "border-red-600 text-red-600"
                    : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300",
                ].join(" ")}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={15} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop: vertical sidebar */}
      <nav
        className="hidden lg:flex flex-col w-56 shrink-0 border-r border-gray-200 bg-white min-h-full py-6 px-3"
        aria-label="Dashboard navigation"
      >
        {navLinks.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/dashboard" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={[
                "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150",
                isActive
                  ? "bg-red-50 text-red-600"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
              ].join(" ")}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
