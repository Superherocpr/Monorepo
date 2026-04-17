"use client";

/**
 * BookSessionSelector — Step 1 client component for the booking wizard.
 * Renders class type filter pills, session cards with "Select" buttons,
 * and handles session selection + routing to the next step.
 * Used by: app/(public)/book/page.tsx
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Calendar, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setBookingStore } from "@/lib/booking-store";
import BookingProgress from "./BookingProgress";
import type { ScheduleSession, ClassTypeOption } from "@/types/schedule";

interface BookSessionSelectorProps {
  sessions: ScheduleSession[];
  classTypes: ClassTypeOption[];
  preSelectedSessionId: string | null;
  preSelectedClassSlug: string | null;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

/** Converts a class type name to a URL-safe slug, matching /classes page anchors. */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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

/** Formats an ISO date to a long group header, e.g. "Tuesday, April 22, 2025". */
function formatGroupDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Formats an ISO date to a short label, e.g. "Apr 22, 2025". */
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Renders the full Step 1 booking UI: filter bar, session cards, progress bar.
 * Handles pre-selection from URL params, guards full sessions, and routes
 * already-signed-in users directly to /book/payment.
 */
export default function BookSessionSelector({
  sessions,
  classTypes,
  preSelectedSessionId,
  preSelectedClassSlug,
}: BookSessionSelectorProps) {
  const router = useRouter();
  const [activeClassType, setActiveClassType] = useState<string | null>(
    preSelectedClassSlug ?? null
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selecting, setSelecting] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isFiltered = !!activeClassType || !!dateFrom || !!dateTo;

  function clearFilters() {
    setActiveClassType(null);
    setDateFrom("");
    setDateTo("");
  }

  // Auto-select if ?session= param is present on mount
  useEffect(() => {
    if (!preSelectedSessionId) return;
    const session = sessions.find((s) => s.id === preSelectedSessionId);
    if (session && !session.isFull) {
      handleSelect(session);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Handles a session card "Select" click.
   * Writes session details to the booking store, then routes to sign-in or
   * directly to payment if the user is already authenticated.
   */
  async function handleSelect(session: ScheduleSession) {
    if (session.isFull) {
      setErrorMessage("Sorry, this class is now full. Please select another.");
      return;
    }

    setErrorMessage(null);
    setSelecting(session.id);

    setBookingStore({
      sessionId: session.id,
      sessionDetails: {
        className: session.class_types.name,
        instructorName: `${session.profiles.first_name} ${session.profiles.last_name}`,
        startsAt: session.starts_at,
        endsAt: session.ends_at,
        locationName: session.locations.name,
        locationAddress: session.locations.address,
        locationCity: session.locations.city,
        locationState: session.locations.state,
        locationZip: session.locations.zip,
        price: session.class_types.price,
        spotsRemaining: session.spotsRemaining,
      },
    });

    // Check if already authenticated — if so, skip sign-in/details steps
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      setBookingStore({ customerId: data.user.id, isNewCustomer: false });
      router.push("/book/payment");
    } else {
      router.push("/book/signin");
    }
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filteredSessions = sessions.filter((session) => {
    const sessionDate = new Date(session.starts_at);
    if (sessionDate < new Date()) return false;
    if (activeClassType && toSlug(session.class_types.name) !== activeClassType) return false;
    if (dateFrom && sessionDate < new Date(dateFrom)) return false;
    if (dateTo && sessionDate > new Date(dateTo + "T23:59:59")) return false;
    return true;
  });

  // ── Group by calendar date ─────────────────────────────────────────────────
  const grouped = filteredSessions.reduce<Record<string, ScheduleSession[]>>(
    (acc, session) => {
      const key = formatGroupDate(session.starts_at);
      if (!acc[key]) acc[key] = [];
      acc[key].push(session);
      return acc;
    },
    {}
  );

  const dateGroups = Object.entries(grouped);

  return (
    <div className="min-h-screen bg-white">
      <BookingProgress currentStep={1} />

      {/* Page header */}
      <div className="px-4 pb-6 max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900">Choose Your Class</h1>
        <p className="text-gray-500 mt-1">
          Select an upcoming session to reserve your spot.
        </p>
      </div>

      {/* Error toast */}
      {errorMessage && (
        <div
          role="alert"
          className="mx-4 mb-4 max-w-7xl lg:mx-auto bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center justify-between"
        >
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            aria-label="Dismiss error"
            className="ml-4 text-red-400 hover:text-red-600"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <section className="pb-16 px-4">
        <div className="max-w-7xl mx-auto">

          {/* ── Filter bar ── */}
          <div className="flex flex-col gap-5 mb-10">
            <div
              className="flex gap-2 overflow-x-auto pb-1 flex-nowrap md:flex-wrap"
              role="group"
              aria-label="Filter by class type"
            >
              <button
                onClick={() => setActiveClassType(null)}
                aria-pressed={activeClassType === null}
                className={[
                  "shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                  activeClassType === null
                    ? "bg-red-600 text-white"
                    : "bg-white border border-gray-200 text-gray-700 hover:border-red-300",
                ].join(" ")}
              >
                All Classes
              </button>

              {classTypes.map((ct) => {
                const slug = toSlug(ct.name);
                const isActive = activeClassType === slug;
                return (
                  <button
                    key={ct.id}
                    onClick={() => setActiveClassType(isActive ? null : slug)}
                    aria-pressed={isActive}
                    className={[
                      "shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                      isActive
                        ? "bg-red-600 text-white"
                        : "bg-white border border-gray-200 text-gray-700 hover:border-red-300",
                    ].join(" ")}
                  >
                    {ct.name}
                  </button>
                );
              })}
            </div>

            {/* Date range row */}
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="book-date-from"
                  className="text-sm font-medium text-gray-700"
                >
                  From
                </label>
                <input
                  id="book-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="book-date-to"
                  className="text-sm font-medium text-gray-700"
                >
                  To
                </label>
                <input
                  id="book-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              {isFiltered && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 rounded-sm sm:self-end pb-[9px]"
                >
                  <X size={14} aria-hidden="true" />
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* ── Session list or empty state ── */}
          {dateGroups.length === 0 ? (
            <BookingEmptyState isFiltered={isFiltered} onClearFilters={clearFilters} />
          ) : (
            <div className="flex flex-col gap-10">
              {dateGroups.map(([dateLabel, daySessions]) => (
                <div key={dateLabel}>
                  <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4 border-b border-gray-100 pb-2">
                    {dateLabel}
                  </h2>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {daySessions.map((session) => (
                      <BookingSessionCard
                        key={session.id}
                        session={session}
                        isSelecting={selecting === session.id}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Session Card ──────────────────────────────────────────────────────────────

interface BookingSessionCardProps {
  session: ScheduleSession;
  isSelecting: boolean;
  onSelect: (session: ScheduleSession) => void;
}

/** Renders a single session card with a "Select" button instead of a "Book Now" link. */
function BookingSessionCard({ session, isSelecting, onSelect }: BookingSessionCardProps) {
  const timeRange = formatTimeRange(session.starts_at, session.ends_at);
  const formattedDate = formatShortDate(session.starts_at);
  const price = session.class_types.price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  });

  return (
    <article className="border border-gray-200 rounded-xl p-5 flex flex-col gap-3 hover:border-gray-300 transition-colors duration-150">
      <h3 className="text-lg font-bold text-gray-900">{session.class_types.name}</h3>

      <p className="text-sm text-gray-500">
        Instructor:{" "}
        <span className="text-gray-700">
          {session.profiles.first_name} {session.profiles.last_name}
        </span>
      </p>

      <p className="text-sm text-gray-700 font-medium">{timeRange}</p>

      <address className="not-italic text-sm text-gray-600 leading-relaxed">
        {session.locations.name}
        <br />
        {session.locations.address}
        <br />
        {session.locations.city}, {session.locations.state} {session.locations.zip}
      </address>

      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">{price} / person</span>
        <SpotsIndicator
          spotsRemaining={session.spotsRemaining}
          isFull={session.isFull}
        />
      </div>

      {session.isFull ? (
        <button
          disabled
          aria-disabled="true"
          className="w-full border-2 border-red-200 text-red-400 font-semibold py-2.5 rounded-lg cursor-not-allowed text-sm"
        >
          Class Full
        </button>
      ) : (
        <button
          onClick={() => onSelect(session)}
          disabled={isSelecting}
          aria-label={`Select ${session.class_types.name} on ${formattedDate}`}
          className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors duration-150 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        >
          {isSelecting ? "Selecting…" : "Select"}
        </button>
      )}
    </article>
  );
}

// ── Spots Indicator ───────────────────────────────────────────────────────────

interface SpotsIndicatorProps {
  spotsRemaining: number;
  isFull: boolean;
}

/** Colored availability badge based on spots remaining. */
function SpotsIndicator({ spotsRemaining, isFull }: SpotsIndicatorProps) {
  if (isFull) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-medium">
        Full
      </span>
    );
  }
  if (spotsRemaining <= 4) {
    return (
      <span className="text-sm font-medium text-amber-600">
        Only {spotsRemaining} spot{spotsRemaining !== 1 ? "s" : ""} left
      </span>
    );
  }
  return (
    <span className="text-sm font-medium text-green-600">
      {spotsRemaining} spots available
    </span>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

interface BookingEmptyStateProps {
  isFiltered: boolean;
  onClearFilters: () => void;
}

/** Shown when no sessions match current filters. */
function BookingEmptyState({ isFiltered, onClearFilters }: BookingEmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-20">
      <Calendar className="text-gray-300" size={48} aria-hidden="true" />
      <h2 className="text-xl font-semibold text-gray-900">No classes found</h2>
      <p className="text-gray-600 max-w-md leading-relaxed">
        No upcoming sessions match your filters. Try adjusting your search or
        contact us to arrange a private session.
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-4 mt-2">
        {isFiltered && (
          <button
            onClick={onClearFilters}
            className="text-sm font-medium text-red-600 hover:text-red-700 transition-colors duration-150"
          >
            Clear filters
          </button>
        )}
        <a
          href="/contact"
          className="text-sm font-medium text-gray-600 hover:text-red-600 transition-colors duration-150"
        >
          Contact us
        </a>
      </div>
    </div>
  );
}
