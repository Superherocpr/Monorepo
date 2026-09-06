/**
 * Layout for all /admin/* routes.
 * Handles auth guard: redirects unauthenticated users, non-staff, archived, and
 * deactivated accounts to /. Provides the shared sidebar + top bar chrome.
 * Injects a dark mode flash-prevention script that reads localStorage before
 * first paint so dark mode users don't see a flash of light mode.
 * Used by: every page under app/(admin)/
 */

import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import AdminSidebar from "./_components/AdminSidebar";
import AdminTopBar from "./_components/AdminTopBar";
import ViewAsBanner from "./_components/ViewAsBanner";

/**
 * Wraps all /admin/* pages with auth guard, sidebar, and top bar.
 * Redirects if: not logged in, not a staff role, archived, or deactivated.
 * The chrome (sidebar, badges, banners) renders against the EFFECTIVE role so
 * a super admin using "View As" experiences the downgraded role's UI.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // getAdminActor handles the archived/deactivated/non-staff checks (THREAT-018)
  // and resolves the view-as effective role from the admin-view-as cookie.
  const actor = await getAdminActor();
  if (!actor) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    redirect(user ? "/" : "/signin?redirect=/admin");
  }

  const { user, profile, realRole, effectiveRole, isViewingAs } = actor;
  const admin = await createAdminClient();
  const role = effectiveRole;

  // Check if instructor has a payout email. Fetched separately so a DB error
  // (e.g. column not yet added via migration 0020) cannot break the auth guard above.
  let showPaymentBanner = false;
  if (role === "instructor" || role === "super_admin") {
    const { data: payoutRow, error: payoutError } = await admin
      .from("profiles")
      .select("paypal_payout_email")
      .eq("id", user.id)
      .single();
    // Only show banner if the query succeeded and email is absent.
    // If the column doesn't exist yet, payoutError will be set and we suppress the banner.
    if (!payoutError) {
      showPaymentBanner = !payoutRow?.paypal_payout_email;
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      <AdminSidebar role={role} />
      <div className="flex flex-col flex-1 min-w-0">
        <AdminTopBar
          firstName={profile.first_name}
          lastName={profile.last_name}
          realRole={realRole}
          effectiveRole={effectiveRole}
          isViewingAs={isViewingAs}
        />
        {/* View-as indicator: always visible while a super admin is downgraded */}
        {isViewingAs && <ViewAsBanner effectiveRole={effectiveRole} />}
        {/* Instructor onboarding banner: shown until a payout email is saved */}
        {showPaymentBanner && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-amber-800 font-medium">
              Add your PayPal payout email so SuperHeroCPR can pay your instructor share.
            </p>
            <a
              href="/admin/profile/payment"
              className="shrink-0 text-sm font-semibold text-amber-900 hover:text-amber-700 underline underline-offset-2 transition-colors"
            >
              Set Up Payouts →
            </a>
          </div>
        )}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
