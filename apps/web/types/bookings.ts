/**
 * TypeScript interfaces for booking and payment database tables.
 * Covers: bookings, payments.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 */

/** Source of a booking from the bookings.booking_source enum. */
export type BookingSource = "online" | "rollcall" | "invoice" | "manual";

/**
 * A customer's booking for a class session from the `bookings` table.
 */
export interface Booking {
  id: string;
  session_id: string;
  customer_id: string;
  invoice_id: string | null;
  booking_source: BookingSource;
  created_by: string | null;
  manual_booking_reason: string | null;
  cancelled: boolean;
  cancellation_note: string | null;
  cancelled_by: string | null;
  grade: number | null;
  created_at: string;
  updated_at: string;
}

/** Payment status values for payments.status enum. */
export type PaymentStatus = "pending" | "completed" | "failed";

/** Payment method values for payments.payment_type enum. */
export type PaymentType =
  | "online"
  | "cash"
  | "check"
  | "deposit"
  | "invoice";

/**
 * A booking with all related data joined in, as returned by the dashboard
 * and bookings page queries. Separate from the flat `Booking` interface.
 */
export interface BookingRecord {
  id: string;
  cancelled: boolean;
  cancellation_note: string | null;
  booking_source: BookingSource;
  created_at: string;
  class_sessions: {
    starts_at: string;
    ends_at: string;
    status: string;
    class_types: { name: string };
    profiles: { first_name: string; last_name: string };
    locations: {
      name: string;
      address: string;
      city: string;
      state: string;
      zip: string;
    };
  };
  payments: {
    status: string;
    payment_type: string;
    amount: number;
  }[];
}

/**
 * Minimal booking shape used in the dashboard upcoming classes widget.
 * Only includes the fields needed for the compact widget display.
 */
export interface UpcomingBookingWidget {
  id: string;
  class_sessions: {
    starts_at: string;
    ends_at: string;
    class_types: { name: string };
    locations: { name: string; address: string; city: string; state: string };
  };
}

/**
 * A payment record from the `payments` table.
 * Loosely coupled to bookings — a payment may exist without a booking (e.g. deposit).
 */
export interface Payment {
  id: string;
  customer_id: string;
  booking_id: string | null;
  logged_by: string | null;
  amount: number;
  status: PaymentStatus;
  payment_type: PaymentType;
  paypal_transaction_id: string | null;
  notes: string | null;
  created_at: string;
}
