"use client";

/**
 * /book/confirmation — Step 5 of the booking wizard: booking confirmed.
 * Captures session details before clearing the store, then displays the
 * confirmation summary with links to dashboard, booking again, and home.
 * Used by: booking flow after /api/bookings/confirm returns success.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Clock, MapPin } from "lucide-react";
import { getBookingStore, clearBookingStore } from "@/lib/booking-store";
import BookingProgress from "../_components/BookingProgress";
import type { BookingStore } from "@/lib/booking-store";

/** Formats an ISO timestamp to a readable date, e.g. "Tuesday, April 22, 2025". */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Formats a start + end ISO pair to "9:00 AM – 11:00 AM". */
function formatTimeRange(startsAt: string, endsAt: string): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

/** Renders the booking confirmation screen (Step 5). */
export default function BookConfirmationPage() {
  const router = useRouter();
  const [details, setDetails] = useState<BookingStore["sessionDetails"]>(null);

  // On mount: capture details before clearing the store.
  // Guard against direct navigation with no prior booking.
  useEffect(() => {
    const store = getBookingStore();
    if (!store.sessionId) {
      router.replace("/book");
      return;
    }
    // Capture before clearing — once cleared, the data is gone
    setDetails(store.sessionDetails);
    clearBookingStore();
  }, [router]);

  return (
    <div className="min-h-screen bg-white">
      <BookingProgress currentStep={5} />

      <div className="max-w-2xl mx-auto px-4 pb-16 text-center">

        {/* Success icon */}
        <div className="flex justify-center mb-6">
          <CheckCircle
            size={64}
            className="text-green-500"
            aria-hidden="true"
            strokeWidth={1.5}
          />
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-3">You&apos;re All Set!</h1>
        <p className="text-gray-500 text-base mb-10">
          A confirmation email has been sent to your inbox with your booking details and receipt.
        </p>

        {/* Booking summary card */}
        {details && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-left mb-10 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-gray-900">{details.className}</h2>

            <div className="flex items-start gap-3 text-sm text-gray-700">
              <Clock size={16} className="text-gray-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">{formatDate(details.startsAt)}</p>
                <p className="text-gray-500">{formatTimeRange(details.startsAt, details.endsAt)}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 text-sm text-gray-700">
              <MapPin size={16} className="text-gray-400 mt-0.5 shrink-0" aria-hidden="true" />
              <address className="not-italic leading-relaxed">
                <span className="font-medium">{details.locationName}</span>
                <br />
                {details.locationAddress}
                <br />
                {details.locationCity}, {details.locationState} {details.locationZip}
              </address>
            </div>

            <p className="text-sm text-gray-500 border-t border-gray-200 pt-4">
              Paid:{" "}
              <span className="font-semibold text-gray-900">
                {details.price.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: 0,
                })}
              </span>
            </p>
          </div>
        )}

        {/* Action links */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/dashboard/bookings"
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            View my bookings
          </Link>
          <Link
            href="/book"
            className="px-6 py-3 border border-gray-300 hover:border-gray-400 text-gray-700 font-semibold rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            Book another class
          </Link>
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-red-600 font-medium transition-colors duration-150"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
