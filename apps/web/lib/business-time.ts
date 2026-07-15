/**
 * business-time.ts — business-time-zone date helpers.
 *
 * The business operates in Florida: anything that reasons about "today"
 * (rollcall codes, today's classes) must use the Eastern calendar day, not
 * UTC. Using UTC midnight once made evening classes (after 8 PM EDT) vanish
 * from rollcall when UTC rolled to the next day.
 *
 * Pure Intl — safe in both server routes and client components, DST-correct
 * without offset arithmetic.
 */

/** IANA time zone the business operates in. */
export const BUSINESS_TIME_ZONE = "America/New_York";

/**
 * Formats an instant as its YYYY-MM-DD calendar date in the business time
 * zone (en-CA locale renders dates as YYYY-MM-DD).
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
