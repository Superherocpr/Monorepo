/**
 * PublicFooter — site-wide footer for the public site and customer portal.
 * Used by app/(public)/layout.tsx on every public and dashboard page.
 * Server component — no interactivity required.
 */

import Link from "next/link";

const FOOTER_LINKS = [
  { label: "Home", href: "/" },
  { label: "Classes", href: "/classes" },
  { label: "Schedule", href: "/schedule" },
  { label: "Merch", href: "/merch" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
] as const;

/**
 * Renders the public site footer with nav links, business info, and copyright.
 */
export function PublicFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-gray-900 text-gray-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

          {/* Brand */}
          <div>
            <p className="text-white font-extrabold text-lg tracking-tight mb-2">
              <span className="text-red-500">Superhero</span> CPR
            </p>
            <p className="text-sm leading-relaxed">
              AHA-certified CPR, BLS, and First Aid training in Tampa, Florida.
              On-location classes for individuals, businesses, and healthcare providers.
            </p>
          </div>

          {/* Nav links */}
          <div>
            <p className="text-white text-sm font-semibold mb-3">Quick Links</p>
            <ul className="flex flex-col gap-2">
              {FOOTER_LINKS.map(({ label, href }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm hover:text-white transition-colors duration-150"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact info */}
          <div>
            <p className="text-white text-sm font-semibold mb-3">Contact</p>
            <ul className="flex flex-col gap-2 text-sm">
              <li>Tampa Bay Area, Florida</li>
              <li>
                <a
                  href="mailto:info@superherocpr.com"
                  className="hover:text-white transition-colors duration-150"
                >
                  info@superherocpr.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 pt-6 border-t border-gray-800 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-gray-500">
          <p>© {year} Superhero CPR. All rights reserved.</p>
          <p>American Heart Association Authorized Training Center</p>
        </div>
      </div>
    </footer>
  );
}
