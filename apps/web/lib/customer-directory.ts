/**
 * customer-directory.ts — shared shape for staff-facing customer lists.
 *
 * Both /api/customers/search (admin customers page) and /api/customers/lookup
 * (the session page's add-student modal) render the same Bookings/Certs
 * columns. The counts are computed here so the two routes cannot drift into
 * reporting different numbers for the same customer.
 *
 * Class times are floating wall-clock values (migration 0060), so the `now`
 * these functions take must come from floatingNow(), not `new Date()` — see
 * lib/business-time.ts for the contract.
 *
 * That same reference is also used for certification expiry, which IS a real
 * date rather than a class time. The mismatch is deliberate: expiry is
 * date-granular and the two clocks differ by hours, so a single reference is
 * simpler than threading two through for a skew that cannot change an answer.
 */

import {
  getCertificationDaysUntilExpiry,
  isCertificationActive,
} from "@/lib/cert-utils";

/**
 * PostgREST relations a route must select for summarizeCustomerActivity().
 * The `!customer_id` hints are required: bookings has three FKs back to
 * profiles (customer_id, created_by, cancelled_by) and PostgREST cannot
 * resolve the join without being told which one to use.
 */
export const CUSTOMER_ACTIVITY_SELECT =
  "bookings!customer_id ( id, cancelled, class_sessions ( starts_at ) ), " +
  "certifications!customer_id ( id, expires_at )";

/** Booking and certification counts shown alongside a customer row. */
export interface CustomerActivitySummary {
  upcomingBookingsCount: number;
  totalBookingsCount: number;
  activeCertsCount: number;
  hasExpiringSoon: boolean;
}

/** The relation rows summarizeCustomerActivity() reads. */
export interface CustomerActivityRow {
  bookings: {
    cancelled: boolean;
    class_sessions: { starts_at: string } | { starts_at: string }[] | null;
  }[];
  certifications: { expires_at: string }[];
}

/**
 * Counts a customer's active/upcoming bookings and live certifications.
 * @param customer - A profiles row selected with CUSTOMER_ACTIVITY_SELECT.
 * @param now - Reference time in FLOATING space (`new Date(floatingNow())`),
 *   injected so callers can batch a single clock read. Passing a real instant
 *   would count a class as past up to the UTC offset early — a 9:00 AM class
 *   would stop being "upcoming" at 5:00 AM. Certification expiry reuses it; see
 *   the file header for why that mismatch is harmless.
 * @returns The four count fields rendered in staff customer tables.
 */
export function summarizeCustomerActivity(
  customer: CustomerActivityRow,
  now: Date
): CustomerActivitySummary {
  const activeBookings = (customer.bookings ?? []).filter((b) => !b.cancelled);

  const upcomingBookings = activeBookings.filter((b) => {
    const session = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions;
    return session != null && new Date(session.starts_at) >= now;
  });

  const activeCerts = (customer.certifications ?? []).filter((c) =>
    isCertificationActive(c.expires_at, now)
  );

  const expiringSoon = activeCerts.filter(
    (c) => getCertificationDaysUntilExpiry(c.expires_at, now) <= 90
  );

  return {
    upcomingBookingsCount: upcomingBookings.length,
    totalBookingsCount: activeBookings.length,
    activeCertsCount: activeCerts.length,
    hasExpiringSoon: expiringSoon.length > 0,
  };
}
