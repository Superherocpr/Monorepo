"use client";

/**
 * PublicHeader — top navigation bar for the public site and customer portal.
 * Used by app/(public)/layout.tsx on every public and dashboard page.
 * Highlights the active route in red. Shows auth-aware actions on the right.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Primary nav links rendered in both desktop and mobile menus. */
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Classes", href: "/classes" },
  { label: "Schedule", href: "/book" },
  { label: "Merch", href: "/merch" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
] as const;

interface PublicHeaderProps {
  /** Whether a Supabase session exists for the current user. Determined server-side in layout.tsx. */
  isAuthenticated: boolean;
}

/**
 * Renders the sticky public site navigation header.
 * Logo left, nav links center, auth actions right. Collapses to hamburger on mobile.
 * @param isAuthenticated - True when user has an active session.
 */
export function PublicHeader({ isAuthenticated }: PublicHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  /**
   * Signs the current user out via Supabase, then refreshes to clear server session state.
   * Side effect: clears the Supabase auth cookie.
   */
  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  /** Returns true when the given href is an exact match for the current pathname. */
  function isActive(href: string): boolean {
    return pathname === href;
  }

  return (
    <header className="bg-white border-b border-gray-200 dark:bg-gray-900 dark:border-gray-800 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Relative container so the nav can be absolutely centered on the page.
            Logo sits left in flow, auth sits right via ml-auto, and the nav is pinned
            to the exact horizontal center regardless of their differing widths. */}
        <div className="relative flex items-center h-20">

          {/* Brand name — Comic Book font, matches footer style */}
          <Link
            href="/"
            className="flex items-center"
            aria-label="SuperHeroCPR home"
          >
            <span
              className="text-2xl font-bold tracking-tight"
              style={{ fontFamily: "'Comic Book', sans-serif" }}
            >
              <span className="text-gray-900">SuperHero</span><span className="text-red-500">CPR</span>
            </span>
          </Link>

          {/* Desktop nav links — absolutely centered so they're always at the true
              midpoint of the header, independent of logo/auth widths. */}
          <nav
            className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2"
            aria-label="Main navigation"
          >
            {NAV_LINKS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                className={[
                  "text-sm transition-colors duration-150",
                  isActive(href)
                    ? "text-red-600 font-semibold"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white",
                ].join(" ")}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* Desktop auth actions — pushed to the far right */}
          <div className="hidden md:flex items-center ml-auto gap-4">
            {isAuthenticated ? (
                <Link
                  href="/dashboard"
                  className={[
                    "text-sm transition-colors duration-150",
                    pathname.startsWith("/dashboard")
                      ? "text-red-600 font-semibold"
                      : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white",
                  ].join(" ")}
                >
                  Dashboard
                </Link>
            ) : (
              <Link
                href="/signin"
                className="text-sm font-semibold bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors duration-150"
              >
                Sign In
              </Link>
            )}
          </div>

          {/* Mobile hamburger toggle — pushed to the far right */}
          <button
            className="md:hidden ml-auto flex justify-end p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          >
            {/* Animated hamburger / X */}
            <div className="w-5 h-5 flex flex-col justify-center gap-1.5" aria-hidden="true">
              <span className={["block h-0.5 bg-current transition-transform duration-200", mobileOpen ? "rotate-45 translate-y-2" : ""].join(" ")} />
              <span className={["block h-0.5 bg-current transition-opacity duration-200",   mobileOpen ? "opacity-0" : ""].join(" ")} />
              <span className={["block h-0.5 bg-current transition-transform duration-200", mobileOpen ? "-rotate-45 -translate-y-2" : ""].join(" ")} />
            </div>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 pb-4">
          <nav className="flex flex-col px-4 pt-3 gap-1" aria-label="Mobile navigation">
            {NAV_LINKS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={[
                  "py-2 px-3 rounded-lg text-sm transition-colors duration-150",
                  isActive(href)
                    ? "text-red-600 font-semibold bg-red-50 dark:bg-red-950"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800",
                ].join(" ")}
              >
                {label}
              </Link>
            ))}

            {/* Mobile auth actions */}
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex flex-col gap-1">
              {isAuthenticated ? (
                <Link
                  href="/dashboard"
                  onClick={() => setMobileOpen(false)}
                  className="py-2 px-3 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
                >
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/signin"
                  onClick={() => setMobileOpen(false)}
                  className="py-2 px-3 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                >
                  Sign In
                </Link>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
