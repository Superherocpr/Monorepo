/**
 * Admin Customer Management page — `/admin/customers`
 * Access: manager and super_admin only.
 * Loads the first 50 customers (ordered by last name, includes archived) on the
 * server, then hands off to CustomersClient for search, filters, and creation.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CustomersClient, { CustomerWithMeta } from "@/app/(admin)/_components/CustomersClient";

/** Server component — handles auth, access check, and initial data fetch. */
export default async function CustomersPage() {
  const supabase = await createClient();

  // ── Auth & access check ────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Only managers and super admins may access this page.
  if (
    !profile ||
    (profile.role !== "manager" && profile.role !== "super_admin")
  ) {
    redirect("/admin");
  }

  // ── Initial data fetch — first 50 customers ordered by last name ──────────
  // Use explicit FK hints on bookings because the bookings table has three FKs
  // back to profiles (customer_id, created_by, cancelled_by). Without the hint
  // PostgREST cannot resolve the join and the query returns no data.
  const { data: initialCustomers } = await supabase
    .from("profiles")
    .select(
      `
      id, first_name, last_name, email, phone, created_at, archived,
      bookings!customer_id ( id, cancelled, class_sessions ( starts_at ) ),
      certifications!customer_id ( id, expires_at )
    `
    )
    .eq("role", "customer")
    .order("last_name", { ascending: true })
    .limit(50);

  const now = new Date();

  /**
   * Decorates each raw profile row with pre-computed counts and flags so the
   * client component doesn't need to re-compute them on every render.
   */
  const customersWithMeta: CustomerWithMeta[] = (initialCustomers ?? []).map(
    (customer) => {
      const activeBookings = customer.bookings.filter(
        (b: { cancelled: boolean }) => !b.cancelled
      );
      const upcomingBookings = activeBookings.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (b: any) =>
          new Date(
            Array.isArray(b.class_sessions)
              ? b.class_sessions[0]?.starts_at
              : b.class_sessions?.starts_at
          ) >= now
      );
      const activeCerts = customer.certifications.filter(
        (c: { expires_at: string }) => new Date(c.expires_at) >= now
      );
      const expiringSoon = activeCerts.filter(
        (c: { expires_at: string }) => {
          const days = Math.ceil(
            (new Date(c.expires_at).getTime() - now.getTime()) /
              (1000 * 60 * 60 * 24)
          );
          return days <= 90;
        }
      );

      return {
        id: customer.id,
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        created_at: customer.created_at,
        archived: customer.archived,
        upcomingBookingsCount: upcomingBookings.length,
        totalBookingsCount: activeBookings.length,
        activeCertsCount: activeCerts.length,
        hasExpiringSoon: expiringSoon.length > 0,
      };
    }
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <CustomersClient
        initialCustomers={customersWithMeta}
        userRole={profile.role}
      />
    </main>
  );
}
