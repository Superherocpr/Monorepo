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

  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-gray-950">
      <PublicHeader isAuthenticated={!!user} />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
