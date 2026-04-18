/**
 * /dashboard/bookings — Customer's full booking history.
 * Fully server-rendered. Fetches all bookings and splits into upcoming/past/cancelled.
 * Auth guard is handled by app/(public)/dashboard/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BookingsPageHeader from "./_components/BookingsPageHeader";
import UpcomingBookingsList from "./_components/UpcomingBookingsList";
import PastBookingsList from "./_components/PastBookingsList";
import CancelledBookingsList from "./_components/CancelledBookingsList";
import type { BookingRecord } from "@/types/bookings";

export const metadata = {
  title: "My Bookings | Superhero CPR",
};

/** Renders the customer's full booking history split into upcoming, past, and cancelled groups. */
export default async function BookingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/dashboard/bookings");

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      `id, cancelled, cancellation_note, booking_source, created_at,
       class_sessions (
         starts_at, ends_at, status,
         class_types ( name ),
         profiles ( first_name, last_name ),
         locations ( name, address, city, state, zip )
       ),
       payments ( status, payment_type, amount )`
    )
    .eq("customer_id", user.id)
    .order("class_sessions.starts_at", { ascending: false });

  const now = new Date();
  const all = (bookings ?? []) as BookingRecord[];

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
