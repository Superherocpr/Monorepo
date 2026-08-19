/**
 * Failed-payment logging.
 *
 * Every customer-facing PayPal checkout path writes a `payments` row with
 * status 'failed' when an attempt does not end in a confirmed booking, so the
 * admin payments page and dashboard activity feed surface payment trouble
 * without the customer having to report it.
 *
 * Used by: app/api/bookings/confirm, app/api/team-bookings/[share_token]/signup
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Details of a payment attempt that did not result in a confirmed booking. */
export interface PaymentFailure {
  /** The authenticated customer who attempted to pay. */
  customerId: string;
  /** Amount the customer was attempting to pay, in dollars. */
  amount: number;
  /**
   * PayPal capture id when a capture exists, otherwise the order id so the
   * attempt is still traceable in the PayPal merchant dashboard.
   */
  paypalTransactionId: string | null;
  /** Plain-English failure reason shown in the admin Details column. */
  notes: string;
}

/**
 * Records a failed payment attempt in the `payments` table.
 *
 * `booking_id` is always null: either no booking was ever created, or it was
 * rolled back alongside a refund. `payment_type` is always 'online' — manual
 * cash/check payments cannot fail this way.
 *
 * Best-effort by design. The customer already has a real error in front of
 * them; an insert problem here is ours to reconcile from the server logs, not
 * something that should change their response.
 *
 * Side effects: one INSERT into `payments`.
 *
 * @param supabase - Service-role Supabase client (RLS-bypassing).
 * @param failure - The attempt details to record.
 * @param logPrefix - Route tag for server-side error logs, e.g. "bookings/confirm".
 * @returns Nothing. Errors are logged server-side and swallowed.
 */
export async function logPaymentFailure(
  supabase: SupabaseClient,
  failure: PaymentFailure,
  logPrefix: string
): Promise<void> {
  const { error } = await supabase.from("payments").insert({
    customer_id: failure.customerId,
    booking_id: null,
    amount: failure.amount,
    status: "failed",
    payment_type: "online",
    paypal_transaction_id: failure.paypalTransactionId,
    notes: failure.notes,
  });

  if (error) {
    console.error(`[${logPrefix}] Failed-payment log insert failed`, {
      customerId: failure.customerId,
      notes: failure.notes,
      error,
    });
  }
}

/**
 * PayPal capture issues that mean no real payment attempt ever happened:
 * the order id does not exist, was never approved by the buyer, or was
 * already consumed by an earlier capture.
 */
const NON_ATTEMPT_CAPTURE_ISSUES = new Set([
  "RESOURCE_NOT_FOUND",
  "INVALID_RESOURCE_ID",
  "ORDER_NOT_APPROVED",
  "ORDER_ALREADY_CAPTURED",
]);

/**
 * Decides whether a failed capture represents a genuine customer payment
 * attempt worth recording.
 *
 * `/api/bookings/confirm` is unauthenticated by design — the PayPal order id
 * is the verification — so anyone can post fabricated order ids to it. Logging
 * those would let a script flood the payments table and bury real declines in
 * the admin UI. A fabricated id fails with an issue in
 * {@link NON_ATTEMPT_CAPTURE_ISSUES}, which is exactly the set we skip; a real
 * decline requires a genuine PayPal order the caller had to create first.
 *
 * @param issue - The `details[0].issue` code from PayPal, if any.
 * @returns True when the attempt should be written to the payments table.
 */
export function isLoggableCaptureFailure(issue: string | null): boolean {
  return issue === null || !NON_ATTEMPT_CAPTURE_ISSUES.has(issue);
}

/**
 * Maps a `book_spot` RPC error message to a plain-English reason for the
 * admin payments page.
 *
 * Unknown codes fall through to the raw message rather than a generic string,
 * so a new RPC error never becomes silently unreadable in the admin UI.
 *
 * @param message - The raw error message from the book_spot RPC.
 * @returns A human-readable reason, without the "Captured and refunded:" prefix.
 */
export function describeBookSpotFailure(message: string): string {
  if (message.includes("already_booked")) return "customer already booked into this class";
  if (message.includes("session_full")) return "class filled up during checkout";
  if (message.includes("session_unavailable")) return "class no longer available";
  if (message.includes("session_not_found")) return "session not found";
  return `booking creation failed${message ? ` (${message})` : ""}`;
}
