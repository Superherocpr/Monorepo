"use client";

/**
 * ScheduleClient — filter bar + grouped session list for the /schedule page.
 * Client component — owns all filtering state and display logic.
 * All data is passed as props from the server (page.tsx). No data fetching here.
 * Used by: app/(public)/schedule/page.tsx
 */

import { useState } from "react";
import Link from "next/link";
import { Calendar, X } from "lucide-react";
import type { ScheduleSession, ClassTypeOption } from "@/types/schedule";

interface ScheduleClientProps {
  sessions: ScheduleSession[];
  classTypes: ClassTypeOption[];
  /** Pre-selected class type slug from ?class= query param. Server reads it; passed here as prop. */
  initialClassFilter: string | null;
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Converts a class type name to the same URL-safe slug used on the /classes page. */
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Formats a start + end ISO string pair to e.g. "9:00 AM – 11:00 AM". */
function formatTimeRange(startsAt: string, endsAt: string): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

/** Formats an ISO date string to a long date group header, e.g. "Tuesday, April 22, 2025". */
function formatGroupDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Formats a date string to a short display for the aria-label. */
function formatShortDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Renders the filter bar and grouped session list.
 * Filtering is entirely client-side — no round trips on filter change.
 */
export default function ScheduleClient({
  sessions,
  classTypes,
  initialClassFilter,
}: ScheduleClientProps) {
  const [activeClassType, setActiveClassType] = useState<string | null>(
    initialClassFilter ?? null
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const isFiltered = !!activeClassType || !!dateFrom || !!dateTo;

  function clearFilters() {
    setActiveClassType(null);
    setDateFrom("");
    setDateTo("");
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filteredSessions = sessions.filter((session) => {
    const sessionDate = new Date(session.starts_at);

    // Defensive: skip any session in the past (server query already filters,
    // but clocks can drift between fetch and render)
    if (sessionDate < new Date()) return false;

    // Class type filter — compare slug to keep parity with /classes anchor links
    if (activeClassType) {
      const slug = toSlug(session.class_types.name);
      if (slug !== activeClassType) return false;
    }

    // Date range filter
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
    <section className="py-12 px-4 bg-white">
      <div className="max-w-7xl mx-auto">

        {/* ── Filter bar ── */}
        <div className="flex flex-col gap-5 mb-10">

          {/* Class type pills — horizontally scrollable on mobile */}
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
                htmlFor="schedule-date-from"
                className="text-sm font-medium text-gray-700"
              >
                From
              </label>
              <input
                id="schedule-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="schedule-date-to"
                className="text-sm font-medium text-gray-700"
              >
                To
              </label>
              <input
                id="schedule-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            {/* Clear filters — only when active */}
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
          <EmptyState isFiltered={isFiltered} onClearFilters={clearFilters} />
        ) : (
          <div className="flex flex-col gap-10">
            {dateGroups.map(([dateLabel, daySessions]) => (
              <div key={dateLabel}>
                {/* Date group header */}
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-4 border-b border-gray-100 pb-2">
                  {dateLabel}
                </h2>

                {/* Session cards — 1 col mobile, 2 col desktop */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {daySessions.map((session) => (
                    <SessionCard key={session.id} session={session} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Session Card ──────────────────────────────────────────────────────────────

interface SessionCardProps {
  session: ScheduleSession;
}

/** Renders a single upcoming session card with availability indicator and CTA. */
function SessionCard({ session }: SessionCardProps) {
  const formattedDate = formatShortDate(session.starts_at);
  const timeRange = formatTimeRange(session.starts_at, session.ends_at);
  const price = session.class_types.price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  });

  return (
    <article className="border border-gray-200 rounded-xl p-5 flex flex-col gap-3 hover:border-gray-300 transition-colors duration-150">
      {/* Class name */}
      <h3 className="text-lg font-bold text-gray-900">
        {session.class_types.name}
      </h3>

      {/* Instructor */}
      <p className="text-sm text-gray-500">
        Instructor:{" "}
        <span className="text-gray-700">
          {session.profiles.first_name} {session.profiles.last_name}
        </span>
      </p>

      {/* Time */}
      <p className="text-sm text-gray-700 font-medium">{timeRange}</p>

      {/* Location */}
      <address className="not-italic text-sm text-gray-600 leading-relaxed">
        {session.locations.name}
        <br />
        {session.locations.address}
        <br />
        {session.locations.city}, {session.locations.state}{" "}
        {session.locations.zip}
      </address>

      {/* Price + spots */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">{price} / person</span>
        <SpotsIndicator
          spotsRemaining={session.spotsRemaining}
          isFull={session.isFull}
        />
      </div>

      {/* CTA */}
      {session.isFull ? (
        <button
          disabled
          aria-disabled="true"
          className="w-full border-2 border-red-200 text-red-400 font-semibold py-2.5 rounded-lg cursor-not-allowed text-sm"
        >
          Class Full
        </button>
      ) : (
        <Link
          href={`/book?session=${session.id}`}
          aria-label={`Book ${session.class_types.name} on ${formattedDate}`}
          className="block w-full text-center bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg transition-colors duration-150 text-sm"
        >
          Book Now
        </Link>
      )}
    </article>
  );
}

// ── Spots Indicator ───────────────────────────────────────────────────────────

interface SpotsIndicatorProps {
  spotsRemaining: number;
  isFull: boolean;
}

/** Renders a colored availability indicator based on spots remaining. */
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

interface EmptyStateProps {
  isFiltered: boolean;
  onClearFilters: () => void;
}

/** Renders when no sessions match the current filters. */
function EmptyState({ isFiltered, onClearFilters }: EmptyStateProps) {
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
        <Link
          href="/contact"
          className="text-sm font-medium text-gray-600 hover:text-red-600 transition-colors duration-150"
        >
          Contact us
        </Link>
      </div>
    </div>
  );
}
