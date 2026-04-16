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
