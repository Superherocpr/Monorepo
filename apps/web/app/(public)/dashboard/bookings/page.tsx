/**
 * /dashboard/bookings — Customer's full booking history.
 * Fully server-rendered. Fetches all bookings and splits into upcoming/past/cancelled.
 * Auth guard is handled by app/(public)/dashboard/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import BookingsPageHeader from "./_components/BookingsPageHeader";
import UpcomingBookingsList from "./_components/UpcomingBookingsList";
import PastBookingsList from "./_components/PastBookingsList";
import CancelledBookingsList from "./_components/CancelledBookingsList";
import type { BookingRecord } from "@/types/bookings";

export const metadata = {
  title: "My Bookings | SuperHeroCPR",
};

/** Renders the customer's full booking history split into upcoming, past, and cancelled groups. */
export default async function BookingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/dashboard/bookings");

  // Service-role client required for this query because:
  // - class_sessions RLS policy restricts to future sessions (starts_at > now()),
  //   which would make all past booking session data return null.
  // - payments has no authenticated SELECT policy, so the join always returns empty.
  // The user has already been verified above; adminClient is scoped to their own
  // customer_id in the query filter.
  const adminClient = await createAdminClient();

  const { data: bookings } = await adminClient
    .from("bookings")
    .select(
      `id, cancelled, cancellation_note, booking_source, created_at,
       class_sessions (
         starts_at, ends_at, status,
         class_types ( name ),
         profiles!instructor_id ( first_name, last_name ),
         locations ( name, address, city, state, zip )
       ),
       payments ( status, payment_type, amount )`
    )
    // Note: ordering by a foreign-table column via dot notation is not supported
    // in Supabase JS v2 — display order is handled by in-memory sorts below.
    .eq("customer_id", user.id);

  const now = new Date();
  // Cast via unknown because Supabase infers array shapes for joined tables without
  // generated DB types — the forward FK (bookings.session_id) guarantees single objects at runtime.
  const all = (bookings ?? []) as unknown as BookingRecord[];

  const upcoming = all
    .filter(
      (b) =>
        !b.cancelled && new Date(b.class_sessions.starts_at) >= now
    )
    .sort(
      (a, b) =>
        new Date(a.class_sessions.starts_at).getTime() -
        new Date(b.class_sessions.starts_at).getTime()
    );

  const past = all
    .filter(
      (b) =>
        !b.cancelled && new Date(b.class_sessions.starts_at) < now
    )
    .sort(
      (a, b) =>
        new Date(b.class_sessions.starts_at).getTime() -
        new Date(a.class_sessions.starts_at).getTime()
    );

  const cancelled = all
    .filter((b) => b.cancelled)
    .sort(
      (a, b) =>
        new Date(b.class_sessions.starts_at).getTime() -
        new Date(a.class_sessions.starts_at).getTime()
    );

  return (
    <div>
      <BookingsPageHeader />
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-12">
        <UpcomingBookingsList bookings={upcoming} />
        <PastBookingsList bookings={past} />
        <CancelledBookingsList bookings={cancelled} />
      </div>
    </div>
  );
}
