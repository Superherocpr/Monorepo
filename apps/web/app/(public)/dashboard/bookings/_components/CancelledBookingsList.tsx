/**
 * CancelledBookingsList — collapsible list of the customer's cancelled bookings.
 * Collapsed by default using native <details>/<summary> — no JS needed.
 * Returns null if there are no cancelled bookings.
 * Used by: app/(public)/dashboard/bookings/page.tsx
 */

import type { BookingRecord } from "@/types/bookings";
import { formatClassDate } from "@/lib/business-time";

interface CancelledBookingsListProps {
  bookings: BookingRecord[];
}

/** Renders a collapsible section of cancelled bookings. Returns null if empty. */
export default function CancelledBookingsList({
  bookings,
}: CancelledBookingsListProps) {
  if (bookings.length === 0) return null;

  return (
    <section>
      <details className="bg-white border border-gray-200 rounded-lg">
        <summary className="px-4 py-3 text-sm font-semibold text-gray-600 cursor-pointer select-none list-none flex items-center justify-between hover:bg-gray-50 rounded-lg transition-colors duration-150">
          <span>Cancelled Bookings ({bookings.length})</span>
          <svg
            className="w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </summary>
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {bookings.map((booking) => (
            <div key={booking.id} className="px-4 py-3 flex flex-col gap-0.5">
              <p className="font-semibold text-sm text-gray-900">
                {booking.class_sessions.class_types.name}
              </p>
              <p className="text-xs text-gray-500">
                {formatClassDate(booking.class_sessions.starts_at, { weekday: false })}
              </p>
              {booking.cancellation_note && (
                <p className="text-xs text-gray-400 italic mt-0.5">
                  {booking.cancellation_note}
                </p>
              )}
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
