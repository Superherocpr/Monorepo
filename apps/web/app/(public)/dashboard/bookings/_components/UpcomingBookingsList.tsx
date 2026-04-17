/**
 * UpcomingBookingsList — shows all non-cancelled, future class bookings for the customer.
 * Each card shows full class details with payment status badge.
 * A cancellation notice is shown below all cards (call-to-cancel, not a button).
 * Renders an empty state with CTA if the customer has no upcoming bookings.
 * Used by: app/(public)/dashboard/bookings/page.tsx
 */

import Link from "next/link";
import { CalendarX, Info, MapPin, User, Clock } from "lucide-react";
import type { BookingRecord } from "@/types/bookings";

interface UpcomingBookingsListProps {
  bookings: BookingRecord[];
}

/**
 * Returns a badge label for non-standard booking sources.
 * Online bookings are the norm — no badge needed.
 * @param source - The booking_source enum value
 */
function getBookingSourceLabel(
  source: BookingRecord["booking_source"]
): string | null {
  switch (source) {
    case "rollcall":
      return "Walk-in";
    case "invoice":
      return "Invoice";
    case "manual":
      return "Added by Staff";
    case "online":
      return null;
  }
}

/**
 * Returns the payment display state derived from the booking's payments array.
 * @param payments - Array of payment records on the booking
 */
function getPaymentStatus(payments: BookingRecord["payments"]): {
  label: string;
  amount?: number;
  color: "green" | "amber" | "gray";
} {
  const completed = payments.find((p) => p.status === "completed");
  if (completed) return { label: "Paid", amount: completed.amount, color: "green" };
  const pending = payments.find((p) => p.status === "pending");
  if (pending) return { label: "Payment Pending", color: "amber" };
  return { label: "Pay at Class", color: "gray" };
}

/** Formats a date string to a full readable label: "Tuesday, April 22, 2026". */
function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Formats a start/end pair into a time range string: "9:00 AM – 1:00 PM". */
function formatTimeRange(startsAt: string, endsAt: string): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

const paymentColorClasses = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  gray: "bg-gray-100 text-gray-600",
};

/** Renders the list of upcoming bookings with full detail cards, or an empty state. */
export default function UpcomingBookingsList({
  bookings,
}: UpcomingBookingsListProps) {
  if (bookings.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Upcoming Classes
        </h2>
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-gray-200 rounded-lg">
          <CalendarX
            size={40}
            className="text-gray-300 mb-4"
            aria-hidden="true"
          />
          <p className="font-semibold text-gray-700 mb-1">
            No upcoming classes
          </p>
          <p className="text-sm text-gray-500 mb-6">
            You don&apos;t have any upcoming bookings. Ready to get certified?
          </p>
          <Link
            href="/book"
            className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors duration-150"
          >
            Book a Class
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Upcoming Classes
      </h2>

      <div className="flex flex-col gap-4">
        {bookings.map((booking) => {
          const payment = getPaymentStatus(booking.payments);
          const sourceLabel = getBookingSourceLabel(booking.booking_source);
          const loc = booking.class_sessions.locations;
          const instructor = booking.class_sessions.profiles;

          return (
            <article
              key={booking.id}
              className="bg-white border border-gray-200 rounded-lg p-5 flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="text-base font-bold text-gray-900">
                    {booking.class_sessions.class_types.name}
                  </h3>
                  {sourceLabel && (
                    <span className="inline-block mt-1 text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {sourceLabel}
                    </span>
                  )}
                </div>
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full ${paymentColorClasses[payment.color]}`}
                >
                  {payment.label}
                  {payment.amount !== undefined && (
                    <>
                      {" "}
                      &mdash; $
                      {payment.amount.toLocaleString("en-US", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}
                    </>
                  )}
                </span>
              </div>

              <div className="flex flex-col gap-2 text-sm text-gray-600">
                <div className="flex items-start gap-2">
                  <Clock
                    size={14}
                    className="text-gray-400 mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <p>{formatLongDate(booking.class_sessions.starts_at)}</p>
                    <p className="text-gray-500">
                      {formatTimeRange(
                        booking.class_sessions.starts_at,
                        booking.class_sessions.ends_at
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <User
                    size={14}
                    className="text-gray-400 shrink-0"
                    aria-hidden="true"
                  />
                  <p>
                    Instructor: {instructor.first_name} {instructor.last_name}
                  </p>
                </div>

                <div className="flex items-start gap-2">
                  <MapPin
                    size={14}
                    className="text-gray-400 mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <address className="not-italic leading-relaxed">
                    <span className="font-medium text-gray-800">{loc.name}</span>
                    <br />
                    {loc.address}
                    <br />
                    {loc.city}, {loc.state} {loc.zip}
                  </address>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Cancellation notice — shown once below all cards */}
      <div className="mt-4 flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-blue-800">
        <Info size={15} className="mt-0.5 shrink-0 text-blue-500" aria-hidden="true" />
        <p>
          Need to cancel? Please call us at{" "}
          <a
            href="tel:+18139663969"
            className="font-medium underline hover:no-underline"
          >
            (813) 966-3969
          </a>{" "}
          and we&apos;ll take care of it.
        </p>
      </div>
    </section>
  );
}
