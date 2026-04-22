/**
 * Admin Customer Detail page — `/admin/customers/[id]`
 * Access: manager and super_admin only.
 * Fetches all customer data (profile, bookings, certs, orders, payments,
 * available sessions, cert types) in a single Promise.all and passes
 * to CustomerDetailClient for tab rendering and mutations.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CustomerDetailClient, {
  type CustomerDetailData,
} from "@/app/(admin)/_components/CustomerDetailClient";

/** Page props — Next.js 15+ provides params as a Promise in App Router. */
interface PageProps {
  params: Promise<{ id: string }>;
}

/** Server component — handles auth, access, and the full data fetch. */
export default async function CustomerDetailPage({ params }: PageProps) {
  const { id: customerId } = await params;
  const supabase = await createClient();

  // ── Auth & access check ────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { data: actorProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !actorProfile ||
    (actorProfile.role !== "manager" && actorProfile.role !== "super_admin")
  ) {
    redirect("/admin");
  }

  // ── Full data fetch in one Promise.all ────────────────────────────────────
  const [
    profileResult,
    bookingsResult,
    certificationsResult,
    ordersResult,
    paymentsResult,
    availableSessionsResult,
    certTypesResult,
  ] = await Promise.all([
    // Customer profile
    supabase
      .from("profiles")
      .select(
        "id, first_name, last_name, email, phone, address, city, state, zip, role, archived, created_at"
      )
      .eq("id", customerId)
      .single(),

    // Bookings with session, instructor, location, and payment info
    supabase
      .from("bookings")
      .select(
        `
        id, booking_source, cancelled, cancellation_note,
        cancelled_by, manual_booking_reason, created_by,
        grade, created_at,
        class_sessions (
          id, starts_at, ends_at, status,
          class_types ( name ),
          locations ( name, city, state ),
          profiles ( first_name, last_name )
        ),
        payments ( id, amount, status, payment_type, created_at )
      `
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),

    // Certifications with cert type and originating session
    supabase
      .from("certifications")
      .select(
        `
        id, issued_at, expires_at, cert_number, notes,
        cert_types ( name, issuing_body, validity_months ),
        class_sessions ( starts_at, class_types ( name ) )
      `
      )
      .eq("customer_id", customerId)
      .order("expires_at", { ascending: true }),

    // Merch orders with line items
    supabase
      .from("orders")
      .select(
        `
        id, status, total_amount, tracking_number,
        shipping_name, shipping_address, shipping_city,
        shipping_state, shipping_zip, created_at,
        order_items (
          quantity, price_at_purchase,
          product_variants ( size, products ( name ) )
        )
      `
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),

    // Payments with linked booking/session info
    supabase
      .from("payments")
      .select(
        `
        id, amount, status, payment_type,
        paypal_transaction_id, notes, created_at, logged_by,
        bookings (
          class_sessions ( starts_at, class_types ( name ) )
        )
      `
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),

    // Approved upcoming sessions for the "Add Booking" panel
    supabase
      .from("class_sessions")
      .select(
        `
        id, starts_at, ends_at, max_capacity,
        class_types ( name ),
        locations ( name, city, state ),
        bookings!session_id ( id, cancelled )
      `
      )
      .eq("approval_status", "approved")
      .eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(50),

    // Active cert types for the "Issue Cert" panel
    supabase
      .from("cert_types")
      .select("id, name, issuing_body, validity_months")
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);

  // Log query errors to the server terminal to aid debugging.
  if (profileResult.error) {
    console.error("[CustomerDetail] profile query error:", profileResult.error);
  }
  if (bookingsResult.error) {
    console.error("[CustomerDetail] bookings query error:", bookingsResult.error);
  }
  if (certificationsResult.error) {
    console.error("[CustomerDetail] certifications query error:", certificationsResult.error);
  }
  if (ordersResult.error) {
    console.error("[CustomerDetail] orders query error:", ordersResult.error);
  }
  if (paymentsResult.error) {
    console.error("[CustomerDetail] payments query error:", paymentsResult.error);
  }
  if (availableSessionsResult.error) {
    console.error("[CustomerDetail] availableSessions query error:", availableSessionsResult.error);
  }
  if (certTypesResult.error) {
    console.error("[CustomerDetail] certTypes query error:", certTypesResult.error);
  }

  // If the profile doesn't exist or isn't a customer, redirect back.
  if (!profileResult.data || profileResult.data.role !== "customer") {
    console.error(
      `[CustomerDetail] redirect — customerId="${customerId}" data=${JSON.stringify(profileResult.data)} error=${JSON.stringify(profileResult.error)}`
    );
    redirect("/admin/customers");
  }

  // Compute spots remaining for each available session so the panel can show it.
  const availableSessions = (availableSessionsResult.data ?? []).map((s) => {
    const confirmedBookings = (s.bookings ?? []).filter(
      (b: { cancelled: boolean }) => !b.cancelled
    ).length;
    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      spotsRemaining: s.max_capacity - confirmedBookings,
      class_types: s.class_types as { name: string },
      locations: s.locations as { name: string; city: string; state: string },
    };
  });

  const data: CustomerDetailData = {
    profile: profileResult.data,
    bookings: bookingsResult.data ?? [],
    certifications: certificationsResult.data ?? [],
    orders: ordersResult.data ?? [],
    payments: paymentsResult.data ?? [],
    availableSessions,
    certTypes: certTypesResult.data ?? [],
    actorRole: actorProfile.role,
    actorId: user.id,
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <CustomerDetailClient data={data} />
    </main>
  );
}
