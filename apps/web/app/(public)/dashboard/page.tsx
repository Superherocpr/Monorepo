/**
 * /dashboard — Customer portal home page.
 * Fully server-rendered. Fetches all widget data in parallel via Promise.all.
 * Auth guard is handled by app/(public)/dashboard/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardWelcome from "./_components/DashboardWelcome";
import UpcomingClassesWidget from "./_components/UpcomingClassesWidget";
import CertificationsWidget from "./_components/CertificationsWidget";
import QuickActionsWidget from "./_components/QuickActionsWidget";
import RecentOrderWidget from "./_components/RecentOrderWidget";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UpcomingBookingWidget } from "@/types/bookings";
import type { CertificationWidgetItem } from "@/types/certifications";
import type { RecentOrderWidget as RecentOrderWidgetType } from "@/types/orders";

export const metadata = {
  title: "My Dashboard | Superhero CPR",
};

/**
 * Fetches the customer's first name and email from the profiles table.
 * @param supabase - Server Supabase client
 * @param userId - Auth user ID
 */
async function fetchProfile(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("first_name, last_name, email")
    .eq("id", userId)
    .single();
  return data;
}

/**
 * Fetches the customer's next 2 upcoming (non-cancelled) class bookings.
 * @param supabase - Server Supabase client
 * @param userId - Auth user ID
 */
async function fetchUpcomingBookings(
  supabase: SupabaseClient,
  userId: string
): Promise<UpcomingBookingWidget[]> {
  const { data } = await supabase
    .from("bookings")
    .select(
      `id, class_sessions ( starts_at, ends_at, class_types ( name ), locations ( name, address, city, state ) )`
    )
    .eq("customer_id", userId)
    .eq("cancelled", false)
    .gte("class_sessions.starts_at", new Date().toISOString())
    .order("class_sessions.starts_at", { ascending: true })
    .limit(2);
  // Cast via unknown — Supabase infers array shapes for joined tables without generated DB types.
  return (data ?? []) as unknown as UpcomingBookingWidget[];
}

/**
 * Fetches all of the customer's certifications, ordered by soonest expiry.
 * @param supabase - Server Supabase client
 * @param userId - Auth user ID
 */
async function fetchCertifications(
  supabase: SupabaseClient,
  userId: string
): Promise<CertificationWidgetItem[]> {
  const { data } = await supabase
    .from("certifications")
    .select("id, issued_at, expires_at, cert_number, cert_types ( name )")
    .eq("customer_id", userId)
    .order("expires_at", { ascending: true });
  // Cast via unknown — Supabase infers array shapes for joined tables without generated DB types.
  return (data ?? []) as unknown as CertificationWidgetItem[];
}

/**
 * Fetches the customer's most recent merch order with items.
 * Returns null if the customer has no orders.
 * @param supabase - Server Supabase client
 * @param userId - Auth user ID
 */
async function fetchRecentOrder(
  supabase: SupabaseClient,
  userId: string
): Promise<RecentOrderWidgetType | null> {
  const { data } = await supabase
    .from("orders")
    .select(
      `id, status, total_amount, tracking_number, created_at,
       order_items ( quantity, price_at_purchase, product_variants ( size, products ( name ) ) )`
    )
    .eq("customer_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  // Cast via unknown — Supabase infers array shapes for joined tables without generated DB types.
  return (data as unknown as RecentOrderWidgetType | null) ?? null;
}

/** Renders the customer dashboard overview with four data widgets. */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/dashboard");

  const [profile, upcomingBookings, certifications, recentOrder] =
    await Promise.all([
      fetchProfile(supabase, user.id),
      fetchUpcomingBookings(supabase, user.id),
      fetchCertifications(supabase, user.id),
      fetchRecentOrder(supabase, user.id),
    ]);

  if (!profile) redirect("/signin?redirect=/dashboard");

  return (
    <div>
      <DashboardWelcome firstName={profile.first_name} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <UpcomingClassesWidget bookings={upcomingBookings} />
          <CertificationsWidget certifications={certifications} />
          <QuickActionsWidget />
          <RecentOrderWidget order={recentOrder} />
        </div>
      </div>
    </div>
  );
}
