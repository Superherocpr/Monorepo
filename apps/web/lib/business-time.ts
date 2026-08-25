/**
 * business-time.ts — class-time and business-time-zone helpers.
 *
 * ── How class times are stored ────────────────────────────────────────────────
 * class_sessions.starts_at / ends_at hold a *floating* wall-clock time: the
 * literal time the instructor typed, stored with a Z suffix but carrying no
 * real timezone meaning. "9:00 AM" is stored as 09:00:00Z and read back as
 * 9:00 AM everywhere — browser, email server, any region.
 *
 * This is deliberate. Classes are in-person events at a fixed venue: a 9:00 AM
 * class is at 9:00 AM for everyone who attends it, and the viewer's location is
 * irrelevant. Converting through timezones only ever introduced errors — it is
 * what once made booking-confirmation emails show 1:00 PM for a 9:00 AM class,
 * because the email renders on a UTC server while /book rendered in the
 * student's browser.
 *
 * Rules:
 *   - DISPLAY a class time  → always via the formatClass* helpers here, which
 *     pin timeZone to UTC so the stored wall clock is read back verbatim.
 *   - COMPARE a class time to "now" → use floatingNow(), never new Date().
 *     Deciding whether a class has started needs the current time *where the
 *     class is*, which is the one place a timezone legitimately applies.
 *   - Real instants (created_at, posted_at, cancelled_at, payment dates) are
 *     NOT class times. They keep normal local formatting — do not route them
 *     through these helpers.
 *
 * Pure Intl — safe in both server routes and client components, DST-correct
 * without offset arithmetic.
 */

/**
 * IANA time zone the business operates in.
 *
 * Used ONLY to answer "what time is it right now" for comparisons, and by the
 * calendar-day helpers below. It is never used to render a class time. When the
 * business expands beyond one region, this is the single constant to revisit —
 * display code is already timezone-free and will not need to change.
 */
export const BUSINESS_TIME_ZONE = "America/New_York";

/** Formatting options shared by every class-time formatter: read the stored wall clock verbatim. */
const FLOATING = { timeZone: "UTC" } as const;

// ── Storing class times ───────────────────────────────────────────────────────

/**
 * Builds a stored class timestamp from the date and time an instructor typed,
 * with no timezone conversion — the entered value is preserved literally.
 * @param date - YYYY-MM-DD, as produced by a date input.
 * @param time - HH:MM (24-hour), as produced by a time input.
 * @returns ISO 8601 string whose wall clock equals the input, e.g. "2026-09-14T09:00:00.000Z".
 */
export function toFloatingISO(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

/**
 * Converts a stored class timestamp into a value for a `datetime-local` input,
 * with no timezone conversion — the round trip through toFloatingISO is exact.
 * @param iso - Stored class timestamp.
 * @returns "YYYY-MM-DDTHH:MM".
 */
export function toDatetimeLocalValue(iso: string): string {
  return iso.slice(0, 16);
}

/**
 * Converts a `datetime-local` input value back into a stored class timestamp,
 * with no timezone conversion.
 * @param value - "YYYY-MM-DDTHH:MM" from a datetime-local input.
 * @returns ISO 8601 string whose wall clock equals the input.
 */
export function fromDatetimeLocalValue(value: string): string {
  return `${value}:00.000Z`;
}

/**
 * Adds minutes to a stored class timestamp, preserving the floating wall clock.
 * Used to derive ends_at from starts_at plus a class type's duration.
 * @param iso - Stored class timestamp.
 * @param minutes - Minutes to add.
 * @returns ISO 8601 string, still floating.
 */
export function addFloatingMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60 * 1000).toISOString();
}

// ── Displaying class times ────────────────────────────────────────────────────

/**
 * Formats a class date, e.g. "Monday, September 14, 2026".
 * @param iso - Stored class timestamp.
 * @param opts.month - "long" (September) or "short" (Sep). Defaults to "long".
 * @param opts.weekday - Include the weekday name. Defaults to true.
 */
export function formatClassDate(
  iso: string,
  opts: { month?: "long" | "short"; weekday?: boolean } = {}
): string {
  const { month = "long", weekday = true } = opts;
  return new Date(iso).toLocaleDateString("en-US", {
    ...FLOATING,
    ...(weekday ? { weekday: "long" as const } : {}),
    year: "numeric",
    month,
    day: "numeric",
  });
}

/**
 * Formats a class start time, e.g. "9:00 AM".
 * @param iso - Stored class timestamp.
 */
export function formatClassTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    ...FLOATING,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Formats a class start/end pair, e.g. "9:00 AM – 11:00 AM".
 * @param startsAt - Stored class start timestamp.
 * @param endsAt - Stored class end timestamp.
 */
export function formatClassTimeRange(startsAt: string, endsAt: string): string {
  return `${formatClassTime(startsAt)} – ${formatClassTime(endsAt)}`;
}

/**
 * Formats a class date and time together in full, e.g.
 * "Monday, September 14, 2026 at 9:00 AM".
 * @param iso - Stored class timestamp.
 */
export function formatClassDateTimeLong(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    ...FLOATING,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Formats a class date and time compactly, e.g. "Mon, Sep 14, 9:00 AM".
 * Used in table rows and digest listings where space is tight.
 * @param iso - Stored class timestamp.
 */
export function formatClassDateTimeShort(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    ...FLOATING,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Extracts the YYYY-MM-DD calendar date of a class, with no timezone conversion.
 * @param iso - Stored class timestamp.
 */
export function classDate(iso: string): string {
  return iso.slice(0, 10);
}

// ── Comparing class times to "now" ────────────────────────────────────────────

/**
 * The current time expressed in the same floating space as stored class times:
 * the wall clock in the business time zone, labelled Z.
 *
 * Use this instead of `new Date().toISOString()` for any comparison against
 * starts_at / ends_at. Comparing a floating class time against a true UTC
 * instant would make classes look past by the length of the UTC offset — a
 * 9:00 AM Eastern class would vanish from /book at 5:00 AM.
 *
 * @returns ISO 8601 string, directly comparable to starts_at / ends_at.
 */
export function floatingNow(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "00";

  // Some ICU versions render midnight as hour "24" under hour12:false.
  const hour = get("hour") === "24" ? "00" : get("hour");

  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}.000Z`;
}

/**
 * Milliseconds until a class starts, measured in the floating space.
 * Negative once the class has started.
 * @param startsAt - Stored class start timestamp.
 */
export function msUntilClass(startsAt: string): number {
  return new Date(startsAt).getTime() - new Date(floatingNow()).getTime();
}

// ── Calendar-day helpers (real instants, not class times) ─────────────────────

/**
 * Formats an instant as its YYYY-MM-DD calendar date in the business time
 * zone (en-CA locale renders dates as YYYY-MM-DD).
 *
 * For genuine instants such as access_code_generated_at. For a class time use
 * classDate() instead, which needs no conversion.
 * @param d - the instant to format
 */
export function businessDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * True when both instants fall on the same calendar day in the business
 * time zone. Used to decide whether a rollcall code is still current.
 * @param a - first instant
 * @param b - second instant
 */
export function isSameBusinessDay(a: Date, b: Date): boolean {
  return businessDate(a) === businessDate(b);
}
