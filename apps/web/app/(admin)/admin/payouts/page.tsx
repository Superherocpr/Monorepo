/**
 * Admin Payouts page — /admin/payouts
 * Access: super_admin only.
 *
 * Operational view of instructor payouts: what is owed and to whom, what the
 * platform actually keeps after PayPal fees, and the full history of payout
 * batches with denial and resend recovery.
 *
 * Renders the same two shared panels as Settings → Payouts, so the two entry
 * points can never drift apart.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import { getPayoutHistory, getUpcomingPayoutsData } from "@/lib/payout-dashboard";
import PayoutsClient from "@/app/(admin)/_components/PayoutsClient";

export const metadata = { title: "Instructor Payouts | SuperHeroCPR Admin" };

/** Server component for the super-admin payout dashboard. */
export default async function PayoutsPage() {
  // Auth guard — super_admin only, honors view-as (archived/deactivated
  // handled inside getAdminActor).
  const actor = await getAdminActor();
  if (!actor || actor.effectiveRole !== "super_admin") redirect("/admin");

  const adminClient = await createAdminClient();
  const [upcoming, history] = await Promise.all([
    getUpcomingPayoutsData(adminClient),
    getPayoutHistory(adminClient),
  ]);

  return <PayoutsClient upcoming={upcoming} history={history} />;
}
