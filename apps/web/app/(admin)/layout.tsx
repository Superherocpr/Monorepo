/**
 * Layout for all /admin/* routes.
 * Handles auth guard: redirects unauthenticated users, non-staff, archived, and
 * deactivated accounts to /. Provides the shared sidebar + top bar chrome.
 * Injects a dark mode flash-prevention script that reads localStorage before
 * first paint so dark mode users don't see a flash of light mode.
 * Used by: every page under app/(admin)/
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminSidebar from "./_components/AdminSidebar";
import AdminTopBar from "./_components/AdminTopBar";
import type { UserRole } from "@/types/users";

/** Roles permitted to access the admin area. */
const STAFF_ROLES: UserRole[] = [
  "instructor",
  "manager",
  "super_admin",
  "inspector",
];

/**
 * Wraps all /admin/* pages with auth guard, sidebar, and top bar.
 * Redirects if: not logged in, not a staff role, archived, or deactivated.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/admin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, role, archived, deactivated")
    .eq("id", user.id)
    .single();

  // Redirect archived, deactivated, or non-staff users immediately.
  // The deactivated check here closes the JWT-window gap described in THREAT-018 —
  // a deactivated staff member with an active session is bounced at the layout level.
  if (
    !profile ||
    profile.archived ||
    profile.deactivated ||
    !STAFF_ROLES.includes(profile.role as UserRole)
  ) {
    redirect("/");
  }

  const role = profile.role as UserRole;

  // Check if instructor has a connected payment account.
  // Only run this query for instructors — other roles don't need it.
  // TODO: replace with full onboarding flow when ready
  let showPaymentBanner = false;
  if (role === "instructor") {
    const { count } = await supabase
      .from("instructor_payment_accounts")
      .select("id", { count: "exact", head: true })
      .eq("instructor_id", user.id);
    showPaymentBanner = !count || count === 0;
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/*
       * Dark mode flash prevention: reads localStorage before first paint and
       * adds the 'dark' class to <html> if the user's preference is dark.
       * Must be a dangerouslySetInnerHTML script — next/script beforeInteractive
       * is not supported inside layouts in the App Router.
       */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}})();`,
        }}
      />
      <AdminSidebar role={role} />
      <div className="flex flex-col flex-1 min-w-0">
        <AdminTopBar
          firstName={profile.first_name}
          lastName={profile.last_name}
          role={role}
        />
        {/* Instructor onboarding banner — shown until a payment account is connected */}
        {showPaymentBanner && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-amber-800 font-medium">
              Connect a payment account to start sending invoices.
            </p>
            <a
              href="/admin/profile/payment"
              className="shrink-0 text-sm font-semibold text-amber-900 hover:text-amber-700 underline underline-offset-2 transition-colors"
            >
              Set Up Payment Account →
            </a>
          </div>
        )}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
