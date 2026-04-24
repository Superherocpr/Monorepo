/**
 * UpcomingClassesWidget — dashboard card showing the customer's next 2 upcoming class sessions.
 * Returns null if the customer has no upcoming bookings (hides the widget entirely).
 * Used by: app/(public)/dashboard/page.tsx
 */

import Link from "next/link";
import type { UpcomingBookingWidget } from "@/types/bookings";

interface UpcomingClassesWidgetProps {
  bookings: UpcomingBookingWidget[];
}

/**
 * Formats a date string to a readable label: "Tuesday, April 22, 2026".
 * @param iso - ISO date string
 */
function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Formats a start/end pair into a time range: "9:00 AM – 1:00 PM".
 * @param startsAt - ISO date string
 * @param endsAt - ISO date string
 */
function formatTimeRange(startsAt: string, endsAt: string): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

/** Renders a card with the customer's next 1–2 upcoming sessions. Returns null if empty. */
export default function UpcomingClassesWidget({
  bookings,
}: UpcomingClassesWidgetProps) {
  if (bookings.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Upcoming Classes
        </h2>
        <Link
          href="/dashboard/bookings"
          className="text-sm text-red-600 hover:text-red-700 font-medium transition-colors duration-150"
        >
          View all
        </Link>
      </div>

      <div className="flex flex-col gap-4">
        {bookings.map((booking, idx) => (
          <div key={booking.id}>
            {idx > 0 && <div className="border-t border-gray-100 mb-4" />}
            <p className="font-semibold text-gray-900">
              {booking.class_sessions.class_types.name}
            </p>
            <p className="text-sm text-gray-600 mt-0.5">
              {formatLongDate(booking.class_sessions.starts_at)}
            </p>
            <p className="text-sm text-gray-500">
              {formatTimeRange(
                booking.class_sessions.starts_at,
                booking.class_sessions.ends_at
              )}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              {booking.class_sessions.locations.name} &mdash;{" "}
              {booking.class_sessions.locations.address},{" "}
              {booking.class_sessions.locations.city},{" "}
              {booking.class_sessions.locations.state}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
