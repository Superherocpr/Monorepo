/**
 * GET /team/[share_token]
 * Access: public — the unguessable share token is the entire credential,
 *   matching the /roster/[session_token] model.
 *
 * The single page a company contact forwards to their employees. It shows the
 * class details, who has signed up so far (first + last name only), a running
 * count, and the signup flow itself. The contact uses the same URL to check
 * their people are on the list — there is no separate manager view.
 *
 * Deliberately not registered in proxy.ts's NAV_PROTECTED list: a private
 * corporate link must keep working even when the public schedule is toggled off.
 */

import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { getTeamBookingByShareToken } from "@/lib/team-bookings";
import TeamSignupClient from "./_components/TeamSignupClient";

/** Private signup links must never be indexed or previewed by crawlers. */
export const metadata: Metadata = {
  title: "Team Class Signup — SuperHeroCPR",
  robots: { index: false, follow: false },
};

/** Always render fresh — the attendee list and seat count change as people sign up. */
export const dynamic = "force-dynamic";

/**
 * Server component — resolves the share token and renders the signup page.
 * @param props - Route params containing the share token.
 */
export default async function TeamSignupPage(props: {
  params: Promise<{ share_token: string }>;
}) {
  const { share_token: shareToken } = await props.params;

  const adminClient = await createAdminClient();
  const view = await getTeamBookingByShareToken(adminClient, shareToken);

  // Invalid and non-existent tokens render identically — nothing here should
  // help someone probe for valid links.
  if (!view) {
    return (
      <main className="min-h-[60vh] flex items-center justify-center px-4 py-16">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-gray-900">This link isn&apos;t valid</h1>
          <p className="mt-3 text-sm text-gray-600">
            The signup link you followed doesn&apos;t match a class. Double-check the link your
            employer sent you, or give us a call at{" "}
            <a href="tel:+18139663969" className="text-red-600 font-medium hover:underline">
              (813) 966-3969
            </a>
            .
          </p>
        </div>
      </main>
    );
  }

  return <TeamSignupClient shareToken={shareToken} initialView={view} />;
}
