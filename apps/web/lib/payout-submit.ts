/**
 * Shared PayPal payout submission and failure recovery.
 *
 * Extracted so POST /api/payouts/create (a fresh batch) and POST /api/payouts/retry
 * (a resend of a denied batch) submit, record, and recover through exactly the
 * same code path. Both receive an already-reserved batch from one of the
 * reservation RPCs and hand it here to be sent.
 *
 * Server-side only; never import from a client component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPayPalPayoutBatch,
  PayPalPayoutRequestError,
} from "@/lib/paypal-payouts";
import type {
  PayoutAttemptOutcome,
  ReservedPayoutResult,
} from "@/types/payouts";

/** Admin Supabase client shape used by payout writes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, "public", any>;

/** Outcome of handing a reserved batch to PayPal. */
export type SubmitPayoutResult =
  | {
      success: true;
      batchId: string;
      paypalBatchId: string;
      totalAmount: number;
      itemCount: number;
    }
  | {
      success: false;
      error: string;
      /** HTTP status the calling route should return. */
      httpStatus: number;
      /** What was done with the reservation: released back, or frozen for review. */
      recovery: "released" | "needs_review";
    };

/** Converts unknown errors to a bounded message safe for admin display. */
export function payoutErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "Unknown payout error";
}

/**
 * Stamps a terminal outcome onto every attempt row belonging to a batch.
 * Side effects: UPDATE instructor_payout_attempts.
 * @param adminClient - Admin Supabase client.
 * @param batchId - Internal payout batch id.
 * @param outcome - Outcome to record against each earning's attempt.
 * @param note - Optional explanation stored on the attempt rows.
 */
async function markBatchAttempts(
  adminClient: AnySupabaseClient,
  batchId: string,
  outcome: PayoutAttemptOutcome,
  note?: string
): Promise<void> {
  const isTerminal = outcome !== "reserved" && outcome !== "submitted";
  await adminClient
    .from("instructor_payout_attempts")
    .update({
      outcome,
      ...(note ? { note } : {}),
      ...(isTerminal ? { resolved_at: new Date().toISOString() } : {}),
    })
    .eq("payout_batch_id", batchId);
}

/**
 * Releases a reserved payout batch after PayPal clearly rejected it.
 *
 * Only safe when PayPal refused the request outright, meaning no money moved.
 * Side effects: earnings return to `pending`, batch/items marked `failed`,
 * attempt rows recorded as `failed`.
 *
 * @param adminClient - Admin Supabase client.
 * @param batchId - Internal payout batch id to release.
 * @param message - Failure reason stored for admin review.
 */
export async function releaseFailedReservation(
  adminClient: AnySupabaseClient,
  batchId: string,
  message: string
): Promise<void> {
  const now = new Date().toISOString();

  await adminClient
    .from("instructor_earnings")
    .update({
      status: "pending",
      payout_batch_id: null,
      payout_item_id: null,
      updated_at: now,
    })
    .eq("payout_batch_id", batchId)
    .eq("status", "payout_pending");

  await adminClient
    .from("instructor_payout_items")
    .update({ status: "failed", error_message: message, updated_at: now })
    .eq("payout_batch_id", batchId);

  await adminClient
    .from("instructor_payout_batches")
    .update({ status: "failed", error_message: message })
    .eq("id", batchId);

  await markBatchAttempts(adminClient, batchId, "failed", message);
}

/**
 * Freezes a reserved batch whose PayPal outcome is unknown.
 *
 * Used when the request may have reached PayPal but the response never did.
 * Earnings deliberately stay `payout_pending` — releasing them here would risk
 * a second payout for money that may already be in flight.
 *
 * Side effects: batch/items marked `needs_review`, attempts recorded as
 * `needs_review`, earnings left locked.
 *
 * @param adminClient - Admin Supabase client.
 * @param batchId - Internal payout batch id whose PayPal result is unknown.
 * @param message - Failure details for the admin dashboard.
 */
export async function holdUncertainReservation(
  adminClient: AnySupabaseClient,
  batchId: string,
  message: string
): Promise<void> {
  const now = new Date().toISOString();
  const reviewMessage = `PayPal result uncertain. Check PayPal for this sender batch before retrying. ${message}`;

  await adminClient
    .from("instructor_payout_batches")
    .update({ status: "needs_review", error_message: reviewMessage })
    .eq("id", batchId);

  await adminClient
    .from("instructor_payout_items")
    .update({ status: "needs_review", error_message: reviewMessage, updated_at: now })
    .eq("payout_batch_id", batchId);

  await markBatchAttempts(adminClient, batchId, "needs_review", reviewMessage);
}

/**
 * Submits an already-reserved payout batch to PayPal and records the result.
 *
 * On success the batch becomes `assumed_complete` rather than `completed`:
 * PayPal returning 201 means it accepted the instruction, not that the money
 * was delivered. Confirmation only comes later from the sync route or the
 * payouts webhook.
 *
 * Side effects: PayPal Payouts API call (moves real money), batch/item/attempt
 * status writes, and on failure either releaseFailedReservation() or
 * holdUncertainReservation().
 *
 * @param adminClient - Admin Supabase client.
 * @param reservation - Successful result from a reservation RPC.
 * @returns Submission result, including which recovery path ran on failure.
 */
export async function submitReservedPayout(
  adminClient: AnySupabaseClient,
  reservation: ReservedPayoutResult
): Promise<SubmitPayoutResult> {
  const batch = reservation.batch;
  const items = reservation.items;

  if (!batch || !items?.length) {
    return {
      success: false,
      error: "No reserved payout items to submit.",
      httpStatus: 400,
      recovery: "released",
    };
  }

  const recipients = items.map((item) => ({
    id: item.id,
    recipientEmail: item.recipient_email,
    amount: Number(item.amount),
    note: "SuperHeroCPR instructor payout",
  }));

  try {
    const paypalResult = await createPayPalPayoutBatch(batch.sender_batch_id, recipients);
    const now = new Date().toISOString();

    await adminClient
      .from("instructor_payout_batches")
      .update({
        status: "assumed_complete",
        paypal_payout_batch_id: paypalResult.payoutBatchId,
        submitted_at: now,
        error_message: null,
      })
      .eq("id", batch.id);

    await Promise.all(
      items.map((item) =>
        adminClient
          .from("instructor_payout_items")
          .update({
            status: "assumed_complete",
            paypal_payout_item_id: paypalResult.itemIdsBySenderItemId[item.id] ?? null,
            error_message: null,
            updated_at: now,
          })
          .eq("id", item.id)
      )
    );

    await markBatchAttempts(adminClient, batch.id, "submitted");

    return {
      success: true,
      batchId: batch.id,
      paypalBatchId: paypalResult.payoutBatchId,
      totalAmount: Number(batch.total_amount),
      itemCount: batch.item_count,
    };
  } catch (error) {
    const message = payoutErrorMessage(error);
    console.error("[payout-submit] PayPal payout failed:", message);

    // A clear 4xx from PayPal (other than 409) means nothing was created, so the
    // earnings can safely go back into the payable pool.
    if (error instanceof PayPalPayoutRequestError && error.safeToReleaseReservation) {
      await releaseFailedReservation(adminClient, batch.id, message);
      return { success: false, error: message, httpStatus: 502, recovery: "released" };
    }

    await holdUncertainReservation(adminClient, batch.id, message);
    return {
      success: false,
      error:
        "PayPal payout result is uncertain. Check the recent payout batch in PayPal before retrying.",
      httpStatus: 502,
      recovery: "needs_review",
    };
  }
}
