/**
 * POST /admin/analytics: server shell
 * Access: super_admin only.
 * Fetches initial analytics data for the default range (last 90 days)
 * and passes it to AnalyticsClient for interactive filtering.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import { AnalyticsClient } from "./_components/AnalyticsClient";
import { fetchAnalyticsData } from "./_components/analyticsData";

/**
 * Server component entry point for /admin/analytics.
 * Enforces super_admin gate (honors view-as) and supplies initial 90-day data.
 */
export default async function AdminAnalyticsPage() {
  const actor = await getAdminActor();
  if (!actor || actor.effectiveRole !== "super_admin") redirect("/admin");

  const admin = await createAdminClient();

  // Default range: last 90 days
  const now = new Date();
  const defaultEnd = now.toISOString();
  const defaultStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const initialData = await fetchAnalyticsData(admin, defaultStart, defaultEnd);

  return (
    <AnalyticsClient
      initialData={initialData}
      initialStart={defaultStart}
      initialEnd={defaultEnd}
    />
  );
}
