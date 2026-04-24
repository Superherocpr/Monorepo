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
        {/* 3-column grid ensures the nav is always centered relative to the full header width,
            regardless of the logo and auth section having different widths. */}
        <div className="grid grid-cols-3 items-center h-20">

          {/* Logo — horizontal brand image at /public/images/SHCPRTextTemplate.png */}
          <Link
            href="/"
            className="flex items-center"
            aria-label="Superhero CPR home"
          >
            <img
              src="/images/SHCPRTextTemplate.png"
              alt="Superhero CPR"
              className="h-[72px] w-auto object-contain"
            />
          </Link>

          {/* Desktop nav links — centered column */}
          <nav className="hidden md:flex items-center justify-center gap-6" aria-label="Main navigation">
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

          {/* Desktop auth actions — right-aligned */}
          <div className="hidden md:flex items-center justify-end gap-4">
            {isAuthenticated ? (
              <>
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
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors duration-150 disabled:opacity-50"
                >
                  {signingOut ? "Signing out…" : "Sign Out"}
                </button>
              </>
            ) : (
              <Link
                href="/signin"
                className="text-sm font-semibold bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors duration-150"
              >
                Sign In
              </Link>
            )}
          </div>

          {/* Mobile hamburger toggle — spans cols 2+3 and right-aligns on mobile */}
          <button
            className="md:hidden col-span-2 flex justify-end p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
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
                <>
                  <Link
                    href="/dashboard"
                    onClick={() => setMobileOpen(false)}
                    className="py-2 px-3 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors"
                  >
                    Dashboard
                  </Link>
                  <button
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="text-left py-2 px-3 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    {signingOut ? "Signing out…" : "Sign Out"}
                  </button>
                </>
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
