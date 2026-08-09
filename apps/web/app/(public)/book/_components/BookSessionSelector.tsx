"use client";

/**
 * BookSessionSelector — Step 1 client component for the booking wizard.
 * Renders class type filter pills, session cards with "Select" buttons,
 * and handles session selection + routing to the next step.
 * Used by: app/(public)/book/page.tsx
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronDown, Loader2, MapPin, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setBookingStore } from "@/lib/booking-store";
import BookingProgress from "./BookingProgress";
import PrivateSessionCta from "./PrivateSessionCta";
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

/** Formats an ISO date to a short label, e.g. "Apr 22, 2025". */
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** The radius used for zip code proximity filtering, in miles. */
const ZIP_RADIUS_MILES = 50;

/**
 * Computes the great-circle distance between two lat/lng points using the
 * Haversine formula. Returns the result in miles.
 * @param lat1 - Latitude of point 1 in decimal degrees
 * @param lng1 - Longitude of point 1 in decimal degrees
 * @param lat2 - Latitude of point 2 in decimal degrees
 * @param lng2 - Longitude of point 2 in decimal degrees
 */
function haversineDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/** Coordinates returned from zip geocoding. */
interface ZipCoords {
  lat: number;
  lng: number;
}

/**
 * Looks up the lat/lng for a US zip code via the free zippopotam.us API.
 * Returns null if the zip is not found or the request fails.
 * @param zip - 5-digit US zip code
 */
async function geocodeZip(zip: string): Promise<ZipCoords | null> {
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      places?: Array<{ latitude: string; longitude: string }>;
    };
    const place = data.places?.[0];
    if (!place) return null;
    return { lat: parseFloat(place.latitude), lng: parseFloat(place.longitude) };
  } catch {
    return null;
  }
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

  // Zip code proximity filter state
  const [zipInput, setZipInput] = useState("");
  const [zipFilter, setZipFilter] = useState(""); // the zip that was actually searched
  const [zipCoords, setZipCoords] = useState<ZipCoords | null>(null);
  // Cache of location zip → coords to avoid re-geocoding on every render
  const [zipCoordsCache, setZipCoordsCache] = useState<Map<string, ZipCoords>>(new Map());
  const [zipError, setZipError] = useState<string | null>(null);
  const [zipLoading, setZipLoading] = useState(false);
  const [classTypeOpen, setClassTypeOpen] = useState(false);
  const [instructorOpen, setInstructorOpen] = useState(false);
  const [activeInstructor, setActiveInstructor] = useState<string | null>(null);

  // Derive the sorted unique instructor list from the sessions passed in
  const instructors = Array.from(
    new Map(
      sessions.map((s) => [
        `${s.profiles.first_name} ${s.profiles.last_name}`,
        { id: s.profiles.email ?? `${s.profiles.first_name}-${s.profiles.last_name}`, name: `${s.profiles.first_name} ${s.profiles.last_name}` },
      ])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const isFiltered = !!activeClassType || !!activeInstructor || !!dateFrom || !!dateTo || !!zipFilter;

  function clearFilters() {
    setActiveClassType(null);
    setActiveInstructor(null);
    setDateFrom("");
    setDateTo("");
    setZipInput("");
    setZipFilter("");
    setZipCoords(null);
    setZipError(null);
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
   * Geocodes the entered zip, pre-geocodes all unique session location zips,
   * and applies the 50-mile radius filter.
   */
  async function handleZipSearch() {
    const zip = zipInput.trim();
    if (!zip) return;

    // Basic 5-digit zip validation before hitting the API
    if (!/^\d{5}$/.test(zip)) {
      setZipError("Please enter a valid 5-digit zip code.");
      return;
    }

    setZipLoading(true);
    setZipError(null);

    const userCoords = await geocodeZip(zip);
    if (!userCoords) {
      setZipLoading(false);
      setZipError("Zip code not found. Please try another.");
      return;
    }

    // Pre-geocode all unique location zips in parallel so the filter runs
    // synchronously without async lookups on every render.
    const uniqueLocationZips = [
      ...new Set(
        sessions
          .map((s) => s.locations?.zip)
          .filter((z): z is string => !!z)
      ),
    ];

    const newCache = new Map<string, ZipCoords>(zipCoordsCache);
    await Promise.all(
      uniqueLocationZips.map(async (locationZip) => {
        if (newCache.has(locationZip)) return; // already cached
        const coords = await geocodeZip(locationZip);
        if (coords) newCache.set(locationZip, coords);
      })
    );

    setZipCoordsCache(newCache);
    setZipCoords(userCoords);
    setZipFilter(zip);
    setZipLoading(false);
  }

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

    const basePrice = session.class_types.price;
    const effectivePrice =
      session.discount_percent != null && session.discount_percent > 0
        ? basePrice * (1 - session.discount_percent / 100)
        : basePrice;

    setBookingStore({
      sessionId: session.id,
      sessionDetails: {
        className: session.class_types.name,
        instructorName: `${session.profiles.first_name} ${session.profiles.last_name}`,
        instructorEmail: session.profiles.email ?? null,
        instructorPhone: session.profiles.phone ?? null,
        startsAt: session.starts_at,
        endsAt: session.ends_at,
        locationName: session.locations.name,
        locationAddress: session.locations.address,
        locationCity: session.locations.city,
        locationState: session.locations.state,
        locationZip: session.locations.zip,
        price: effectivePrice,
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
    if (activeInstructor && `${session.profiles.first_name} ${session.profiles.last_name}` !== activeInstructor) return false;
    if (dateFrom && sessionDate < new Date(dateFrom)) return false;
    if (dateTo && sessionDate > new Date(dateTo + "T23:59:59")) return false;

    // Zip proximity filter — only applied after a successful zip lookup
    if (zipCoords && session.locations?.zip) {
      const locationCoords = zipCoordsCache.get(session.locations.zip);
      // Exclude if the location couldn't be geocoded or is beyond the radius
      if (!locationCoords) return false;
      const distance = haversineDistanceMiles(
        zipCoords.lat,
        zipCoords.lng,
        locationCoords.lat,
        locationCoords.lng
      );
      if (distance > ZIP_RADIUS_MILES) return false;
    }

    return true;
  });


  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">

      {/* Progress bar — full width, pinned at top */}
      <div className="shrink-0 border-b border-gray-100 bg-white z-10">
        <BookingProgress currentStep={1} />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 pt-6 pb-16">

          {/* Title */}
          <div className="mb-5">
            <h1 className="text-2xl font-bold text-gray-900">Choose Your Class</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Select an upcoming session to reserve your spot.
            </p>
          </div>

          {/* Filter bar */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl mb-6 overflow-hidden">

            {/* Row 1: zip + date range + clear */}
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-4 pt-4 pb-4">

              {/* Zip code proximity filter */}
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <input
                    id="book-zip-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={zipInput}
                    onChange={(e) => {
                      // Allow only digits
                      setZipInput(e.target.value.replace(/\D/g, ""));
                      setZipError(null);
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleZipSearch(); }}
                    placeholder="Zip Code"
                    aria-label="Enter your zip code"
                    className="w-32 border border-gray-300 bg-white rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleZipSearch}
                    disabled={zipLoading || zipInput.trim().length !== 5}
                    aria-label="Search classes by zip code"
                    className="shrink-0 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 flex items-center gap-1.5"
                  >
                    {zipLoading ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      "Search"
                    )}
                  </button>
                </div>
                {zipError && (
                  <p role="alert" className="text-xs text-red-600 font-medium">
                    {zipError}
                  </p>
                )}
                {zipFilter && !zipLoading && (
                  <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5">
                    <span className="text-xs text-gray-700">
                      Within <span className="font-semibold">{ZIP_RADIUS_MILES} mi</span> of{" "}
                      <span className="font-semibold">{zipFilter}</span>
                    </span>
                    <button
                      onClick={() => { setZipFilter(""); setZipCoords(null); setZipError(null); }}
                      aria-label="Clear zip code filter"
                      className="text-gray-400 hover:text-red-600 transition-colors duration-150"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>

              <div className="hidden sm:block self-stretch w-px bg-gray-200" aria-hidden="true" />

              {/* Date range filter */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="book-date-from" className="text-xs font-medium text-gray-500">
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
                  <div className="flex flex-col gap-1">
                    <label htmlFor="book-date-to" className="text-xs font-medium text-gray-500">
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
                </div>
              </div>

              {/* Clear all filters */}
              {isFiltered && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 rounded-sm pb-2"
                >
                  <X size={14} aria-hidden="true" />
                  Clear filters
                </button>
              )}
            </div>

            {/* Row 2: collapsable class type section */}
            <div className="border-t border-gray-200">
              <button
                onClick={() => setClassTypeOpen((o) => !o)}
                aria-expanded={classTypeOpen}
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-widest hover:bg-gray-100 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
              >
                <span>Certification Type{activeClassType ? ` · ${classTypes.find(ct => toSlug(ct.name) === activeClassType)?.name ?? ""}` : ""}</span>
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className={`text-gray-400 transition-transform duration-200 ${classTypeOpen ? "rotate-180" : ""}`}
                />
              </button>
              {classTypeOpen && (
                <div
                  className="flex flex-wrap gap-2 px-4 pb-4 pt-1"
                  role="group"
                  aria-label="Filter by certification type"
                >
                  <button
                    onClick={() => setActiveClassType(null)}
                    aria-pressed={activeClassType === null}
                    className={[
                      "px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                      activeClassType === null
                        ? "bg-red-600 text-white"
                        : "bg-white border border-gray-200 text-gray-700 hover:border-red-300",
                    ].join(" ")}
                  >
                    All
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
                          "px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
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
              )}
            </div>

            {/* Row 3: collapsible instructor section — only shown when >1 instructor */}
            {instructors.length > 1 && (
              <div className="border-t border-gray-200">
                <button
                  onClick={() => setInstructorOpen((o) => !o)}
                  aria-expanded={instructorOpen}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-widest hover:bg-gray-100 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
                >
                  <span>Instructor{activeInstructor ? ` · ${activeInstructor}` : ""}</span>
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className={`text-gray-400 transition-transform duration-200 ${instructorOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {instructorOpen && (
                  <div
                    className="flex flex-wrap gap-2 px-4 pb-4 pt-1"
                    role="group"
                    aria-label="Filter by instructor"
                  >
                    <button
                      onClick={() => setActiveInstructor(null)}
                      aria-pressed={activeInstructor === null}
                      className={[
                        "px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                        activeInstructor === null
                          ? "bg-red-600 text-white"
                          : "bg-white border border-gray-200 text-gray-700 hover:border-red-300",
                      ].join(" ")}
                    >
                      All
                    </button>
                    {instructors.map((instructor) => {
                      const isActive = activeInstructor === instructor.name;
                      return (
                        <button
                          key={instructor.id}
                          onClick={() => setActiveInstructor(isActive ? null : instructor.name)}
                          aria-pressed={isActive}
                          className={[
                            "px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2",
                            isActive
                              ? "bg-red-600 text-white"
                              : "bg-white border border-gray-200 text-gray-700 hover:border-red-300",
                          ].join(" ")}
                        >
                          {instructor.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

          </div>{/* end filter bar */}

          {/* Error toast */}
          {errorMessage && (
            <div
              role="alert"
              className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center justify-between"
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

          {/* Session grid or empty state */}
          {filteredSessions.length === 0 ? (
            <BookingEmptyState isFiltered={isFiltered} onClearFilters={clearFilters} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredSessions.map((session) => (
                <BookingSessionCard
                  key={session.id}
                  session={session}
                  isSelecting={selecting === session.id}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}

          {/* Private session CTA — shown below the grid */}
          <div className="-mx-6 mt-8">
            <PrivateSessionCta />
          </div>

        </div>
      </div>
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

  const basePrice = session.class_types?.price ?? 0;
  const hasDiscount = session.discount_percent != null && session.discount_percent > 0;
  const effectivePrice = hasDiscount ? basePrice * (1 - (session.discount_percent as number) / 100) : basePrice;

  const formatPrice = (amount: number) =>
    amount === 0
      ? "Free"
      : amount.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });

  return (
    <article className="border border-gray-200 rounded-xl p-5 flex flex-col gap-3 hover:border-gray-300 transition-colors duration-150">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{session.class_types.name}</h3>
          {session.class_types.is_aha && (
            <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
              AHA Certified
            </span>
          )}
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Instructor:{" "}
        <span className="text-gray-700">
          {session.profiles.first_name} {session.profiles.last_name}
        </span>
      </p>

      <p className="text-sm text-gray-700 font-medium">
        {formattedDate} &bull; {timeRange}
      </p>

      <address className="not-italic text-sm text-gray-600 leading-relaxed">
        {session.locations.name}
        <br />
        {session.locations.address}
        <br />
        {session.locations.city}, {session.locations.state} {session.locations.zip}
      </address>

      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-1.5">
          {hasDiscount && (
            <span className="text-sm text-gray-400 line-through">
              {formatPrice(basePrice)}
            </span>
          )}
          <span className={`text-sm font-semibold ${hasDiscount ? "text-green-700" : "text-gray-900"}`}>
            {formatPrice(effectivePrice)} / person
          </span>
        </div>
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
