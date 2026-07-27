/**
 * Public site layout — wraps every page in the (public) route group.
 * Pages: /, /about, /classes, /schedule, /merch, /contact, /book/*, /rollcall,
 *        /roster/[session_token], /submit-roster, /dashboard/*.
 *
 * Responsibilities:
 * - Reads the current Supabase session server-side to determine auth state
 * - Passes isAuthenticated to PublicHeader (avoids any client-side auth flash)
 * - Renders PublicHeader → page content → PublicFooter
 *
 * Auth guard for /dashboard/* is handled in app/(public)/dashboard/layout.tsx,
 * not here. This layout is intentionally permissive.
 */

import { createClient } from "@/lib/supabase/server";
import { PublicHeader } from "@/app/(public)/_components/PublicHeader";
import { PublicFooter } from "@/app/(public)/_components/PublicFooter";
import { getSetting } from "@/lib/zoho";

/** Nav page keys that can be toggled in admin settings. */
const NAV_PAGES = ["classes", "schedule", "merch", "blog", "about", "contact"] as const;
type NavPage = (typeof NAV_PAGES)[number];
const NAV_SETTING_KEY: Record<NavPage, string> = {
  classes:  "nav_classes_enabled",
  schedule: "nav_schedule_enabled",
  merch:    "nav_merch_enabled",
  blog:     "nav_blog_enabled",
  about:    "nav_about_enabled",
  contact:  "nav_contact_enabled",
};

/**
 * Renders the shared public site shell: sticky header, page content, footer.
 * Determines authentication state on the server to avoid client-side flash.
 * @param children - The current page content rendered between header and footer.
 */
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Read legacy site flag and all nav visibility flags in parallel.
  const [legacyFlag, ...navFlags] = await Promise.all([
    getSetting("legacy_site_enabled"),
    ...NAV_PAGES.map((page) => getSetting(NAV_SETTING_KEY[page])),
  ]);
  const legacyMode = legacyFlag === "true";

  // Build the enabled pages record. Absent or non-"false" = enabled.
  const enabledPages: Record<string, boolean> = {};
  NAV_PAGES.forEach((page, i) => {
    enabledPages[page] = navFlags[i] !== "false";
  });

  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-gray-950">
      <PublicHeader isAuthenticated={!!user} legacyMode={legacyMode} enabledPages={enabledPages} />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
