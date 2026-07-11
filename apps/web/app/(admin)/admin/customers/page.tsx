/**
 * Admin Customer Management page — `/admin/customers`
 * Access: manager and super_admin only.
 * Loads the first 50 customers (ordered by last name, includes archived) on the
 * server, then hands off to CustomersClient for search, filters, and creation.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import {
  getCertificationDaysUntilExpiry,
  isCertificationActive,
} from "@/lib/cert-utils";
import CustomersClient, { CustomerWithMeta } from "@/app/(admin)/_components/CustomersClient";

/** Server component — handles auth, access check, and initial data fetch. */
export default async function CustomersPage() {
  // Only managers and super admins may access this page (honors view-as).
  const actor = await getAdminActor();
  if (!actor || !["manager", "super_admin"].includes(actor.effectiveRole)) {
    redirect("/admin");
  }

  const admin = await createAdminClient();

  // ── Initial data fetch — first 50 customers ordered by last name ──────────
  // Use explicit FK hints on bookings because the bookings table has three FKs
  // back to profiles (customer_id, created_by, cancelled_by). Without the hint
  // PostgREST cannot resolve the join and the query returns no data.
  const { data: initialCustomers } = await admin
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
        (c: { expires_at: string }) => isCertificationActive(c.expires_at, now)
      );
      const expiringSoon = activeCerts.filter(
        (c: { expires_at: string }) => {
          const days = getCertificationDaysUntilExpiry(c.expires_at, now);
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
        userRole={actor.effectiveRole}
      />
    </main>
  );
}
