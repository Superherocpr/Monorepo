/**
 * Presentation helpers for class type details shown on the public site.
 *
 * Previously duplicated in ClassTypeCards.tsx and ClassTypesSection.tsx, and
 * needed by /find-a-class as well, so the three surfaces describe the same
 * course identically.
 */

/**
 * Formats a course length for display, e.g. 120 becomes "2 hours" and 90
 * becomes "1 hr 30 min".
 * @param minutes - Duration from class_types.duration_minutes.
 * @returns A human-readable duration.
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  return `${hours} hr ${mins} min`;
}

/**
 * Formats a course price in whole-dollar US currency, keeping cents only when
 * the price actually has them.
 * @param price - Price from class_types.price.
 * @returns A currency string, e.g. "$85" or "$47.50".
 */
export function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
