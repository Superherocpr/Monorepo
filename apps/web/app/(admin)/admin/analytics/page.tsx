/**
 * POST /admin/analytics — server shell
 * Access: super_admin only.
 * Fetches initial analytics data for the default range (last 90 days)
 * and passes it to AnalyticsClient for interactive filtering.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/users";
import { AnalyticsClient } from "./_components/AnalyticsClient";
import { fetchAnalyticsData } from "./_components/analyticsData";

/**
 * Server component entry point for /admin/analytics.
 * Enforces super_admin gate and supplies initial 90-day data to the client.
 */
export default async function AdminAnalyticsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role as UserRole) !== "super_admin") {
    redirect("/admin");
  }

  // Default range: last 90 days
  const now = new Date();
  const defaultEnd = now.toISOString();
  const defaultStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const initialData = await fetchAnalyticsData(supabase, defaultStart, defaultEnd);

  return (
    <AnalyticsClient
      initialData={initialData}
      initialStart={defaultStart}
      initialEnd={defaultEnd}
    />
  );
}
