/**
 * Upcoming-session availability, per class type.
 *
 * The "does this class have dates I can actually book?" question is asked in two
 * places now: /book renders the sessions themselves, and /find-a-class needs to
 * know whether to send someone to /book or to /request-class. Both must count
 * capacity identically, because the counting rule is not obvious: students on an
 * unpaid invoice still hold their seats, so a session can be full without a
 * single completed booking. A second, hand-rolled version of this arithmetic
 * would eventually advertise dates for classes that have no room left.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { floatingNow } from "@/lib/business-time";

/** A booking row, reduced to what capacity counting needs. */
export interface CapacityBooking {
  cancelled: boolean;
}

/** An invoice row, reduced to what capacity counting needs. */
export interface CapacityInvoice {
  student_count: number;
  status: string;
}

/** What /find-a-class needs to know about one class type's schedule. */
export interface ClassAvailability {
  /** Upcoming, approved, public sessions that still have at least one seat. */
  upcomingCount: number;
}

/**
 * Calculates how many seats are left in a session.
 *
 * Cancelled bookings free their seat; cancelled invoices free theirs. Every
 * other invoice holds its students' seats regardless of payment status, which
 * is what stops an unpaid invoice from being overbooked out from under it.
 *
 * @param maxCapacity - The session's max_capacity.
 * @param bookings - All booking rows for the session, cancelled ones included.
 * @param invoices - All invoice rows for the session, cancelled ones included.
 * @returns Seats remaining, floored at 0.
 */
export function computeSpotsRemaining(
  maxCapacity: number,
  bookings: CapacityBooking[],
  invoices: CapacityInvoice[]
): number {
  const activeBookings = bookings.filter((b) => !b.cancelled).length;
  const invoiceStudents = invoices
    .filter((inv) => inv.status !== "cancelled")
    .reduce((sum, inv) => sum + inv.student_count, 0);

  return Math.max(0, maxCapacity - activeBookings - invoiceStudents);
}

/** Raw session shape returned by the availability query. */
interface AvailabilityRow {
  class_type_id: string;
  starts_at: string;
  max_capacity: number;
  bookings: CapacityBooking[] | null;
  invoices: CapacityInvoice[] | null;
}

/**
 * Builds a per-class-type view of what is bookable right now.
 *
 * Applies the same visibility rules as /book: scheduled, approved, non-private,
 * and starting in the future. Sessions with no seats left are excluded, so a
 * class whose only session is full correctly reports zero upcoming dates.
 *
 * @param supabase - A service-role client. The anon client cannot see other
 *   customers' bookings or any invoices, so it would report every session empty.
 * @returns A map of class_type_id to its availability. Class types with no
 *   bookable sessions are absent from the map.
 */
export async function getClassAvailability(
  supabase: SupabaseClient
): Promise<Map<string, ClassAvailability>> {
  const { data } = await supabase
    .from("class_sessions")
    .select(
      `
      class_type_id,
      starts_at,
      max_capacity,
      bookings ( cancelled ),
      invoices ( student_count, status )
    `
    )
    .eq("status", "scheduled")
    .eq("approval_status", "approved")
    .eq("is_private", false)
    .gte("starts_at", floatingNow());

  const availability = new Map<string, ClassAvailability>();

  for (const row of (data ?? []) as AvailabilityRow[]) {
    const spots = computeSpotsRemaining(
      row.max_capacity,
      row.bookings ?? [],
      row.invoices ?? []
    );
    if (spots <= 0) continue;

    const existing = availability.get(row.class_type_id);
    if (existing) {
      existing.upcomingCount += 1;
    } else {
      availability.set(row.class_type_id, { upcomingCount: 1 });
    }
  }

  return availability;
}
