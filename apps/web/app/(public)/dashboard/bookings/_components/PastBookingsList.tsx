/**
 * PastBookingsList — compact reference list of past (non-cancelled) class bookings.
 * Returns null if the customer has no past bookings — no empty state rendered.
 * Note: grade is not shown — grades are internal staff information only.
 * Used by: app/(public)/dashboard/bookings/page.tsx
 */

import type { BookingRecord } from "@/types/bookings";

interface PastBookingsListProps {
  bookings: BookingRecord[];
}

const sessionStatusStyles: Record<string, string> = {
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
};

/** Returns the badge style classes for a session status value. */
function getStatusStyle(status: string): string {
  return sessionStatusStyles[status] ?? "bg-gray-100 text-gray-600";
}

/** Returns a display label for a session status value. */
function getStatusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Formats a date string to a short readable label: "April 1, 2024". */
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Renders a compact table-style list of past bookings. Returns null if empty. */
export default function PastBookingsList({ bookings }: PastBookingsListProps) {
  if (bookings.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Past Classes
      </h2>
      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {bookings.map((booking) => {
          const instructor = booking.class_sessions.profiles;
          return (
            <div
              key={booking.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3"
            >
              <div className="flex flex-col gap-0.5">
                <p className="font-semibold text-sm text-gray-900">
                  {booking.class_sessions.class_types.name}
                </p>
                <p className="text-xs text-gray-500">
                  {formatShortDate(booking.class_sessions.starts_at)}
                </p>
                <p className="text-xs text-gray-500">
                  Instructor: {instructor.first_name} {instructor.last_name}
                </p>
                <p className="text-xs text-gray-500">
                  {booking.class_sessions.locations.name}
                </p>
              </div>
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full self-start sm:self-center ${getStatusStyle(
                  booking.class_sessions.status
                )}`}
              >
                {getStatusLabel(booking.class_sessions.status)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
