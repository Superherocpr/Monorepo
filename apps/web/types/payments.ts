/**
 * TypeScript interfaces for payment routing.
 * Source of truth: schema.md — do not modify column names without verifying there first.
 * Used by: lib/resolve-payment-routing.ts and the booking confirm route.
 */

/**
 * Result of resolving payment routing for an online booking.
 * Returned by lib/resolve-payment-routing.ts.
 */
export interface PaymentRoutingResult {
  /** PayPal merchant ID of the instructor, or null if routing to business account */
  instructorPayPalAccountId: string | null;
  /** Always set. Written to payments.routing_note for audit trail. */
  routingNote: string;
}

/** Payment routing preference enum stored on profiles.payment_routing. */
export type PaymentRoutingPreference = "instructor" | "business";
