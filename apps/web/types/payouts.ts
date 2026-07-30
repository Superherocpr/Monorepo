/**
 * Payout domain types shared by payout API routes, admin panels, and lib helpers.
 * Defined once here so the reservation RPC shapes and status vocabularies are
 * never redeclared inline (see CLAUDE.md rule 3).
 */

/**
 * Lifecycle status of a payout batch.
 *
 * The distinction between the terminal states is what keeps money safe:
 *   - `assumed_complete` — PayPal accepted the batch but has not confirmed
 *     delivery. Money is presumed sent. This is the honest default, because a
 *     PayPal 201 is an accepted instruction, not a completed transfer.
 *   - `completed` — delivery confirmed by sync or webhook.
 *   - `denied` — PayPal refused it after accepting; funds returned. Safe to resend.
 *   - `failed` — never left the app; PayPal rejected the request. Safe to resend.
 *   - `needs_review` — outcome genuinely unknown (e.g. the network died
 *     mid-request). Must NOT be resent until a human checks PayPal, or the
 *     instructor may be paid twice.
 */
export type PayoutBatchStatus =
  | "pending"
  | "assumed_complete"
  | "completed"
  | "denied"
  | "failed"
  | "needs_review";

/**
 * Lifecycle status of a single instructor's payout item.
 * Adds `unclaimed`: PayPal holds funds for 30 days when the recipient email has
 * no PayPal account attached, then returns them.
 */
export type PayoutItemStatus = PayoutBatchStatus | "unclaimed";

/** How a denial came to be recorded. */
export type PayoutDenialSource = "manual" | "paypal_sync" | "webhook";

/** Outcome recorded against one earning's participation in one payout attempt. */
export type PayoutAttemptOutcome =
  | "reserved"
  | "submitted"
  | "completed"
  | "denied"
  | "failed"
  | "needs_review"
  | "unclaimed";

/** A payout item as returned by the reservation RPCs. */
export interface ReservedPayoutItem {
  id: string;
  instructor_id: string;
  recipient_email: string;
  amount: number | string;
}

/** A payout batch header as returned by the reservation RPCs. */
export interface ReservedPayoutBatch {
  id: string;
  sender_batch_id: string;
  total_amount: number | string;
  item_count: number;
  retry_of_batch_id?: string | null;
}

/**
 * JSON result returned by `reserve_instructor_payout_batch(actor)` and
 * `reserve_payout_retry_batch(actor, source_batch)`.
 *
 * On failure, `reason` explains why and the count fields describe what changed:
 *   - `no_eligible_earnings` / `no_retryable_earnings` — nothing to send
 *   - `source_batch_not_found` / `source_batch_not_retryable` — bad retry target
 *   - `no_attempt_history` — batch predates attempt tracking
 *   - `earnings_changed` — some earnings moved on (`moved`) or became unpayable
 *     (`blocked`), so a retry could double-pay or short-pay
 *   - `earnings_locked` — a concurrent payout holds row locks
 */
export interface ReservedPayoutResult {
  success: boolean;
  reason?: string;
  status?: string;
  attempted?: number;
  moved?: number;
  blocked?: number;
  available?: number;
  batch?: ReservedPayoutBatch;
  items?: ReservedPayoutItem[];
}

// ── Admin dashboard display shapes ───────────────────────────────────────────
// Built server-side by lib/payout-dashboard.ts and passed to the shared panels
// rendered by both /admin/payouts and Settings → Payouts.

/** One class session, or one invoice, contributing to an instructor's payout. */
export interface UpcomingPayoutSource {
  /** Session id or invoice id — stable key for the row. */
  key: string;
  /** Whether this line is a class session or a standalone invoice. */
  kind: "session" | "invoice";
  /** Class type name, or the invoice number. */
  label: string;
  /** Formatted session date, or the invoice recipient. */
  detail: string | null;
  /** ISO session start, when this is a class. */
  sessionDate: string | null;
  /** Students sold for this class (always 1 for an invoice). */
  soldCount: number;
  grossAmount: number;
  platformFeeAmount: number;
  instructorAmount: number;
}

/** An instructor's upcoming payout, broken down by what generated it. */
export interface UpcomingPayoutGroup {
  instructorId: string;
  instructorName: string;
  instructorEmail: string;
  paypalPayoutEmail: string | null;
  grossAmount: number;
  platformFeeAmount: number;
  instructorAmount: number;
  earningCount: number;
  /** Estimated PayPal fee to send this instructor their payout. */
  estimatedPayoutFee: number;
  sources: UpcomingPayoutSource[];
}

/**
 * Revenue and fee totals for a set of earnings.
 *
 * Inbound fees are measured values read from PayPal. Outbound fees are estimates,
 * because the money has not been sent yet — the UI must label them as such.
 */
export interface PayoutRevenueTotals {
  /** Total collected from customers. */
  grossCollected: number;
  /** Platform cut before any PayPal fees. */
  platformCut: number;
  /** Total owed to instructors. */
  instructorTotal: number;
  /** Measured PayPal fees already paid to collect this money. */
  inboundPayPalFees: number;
  /** Earnings with a recorded PayPal fee. */
  feeTrackedCount: number;
  /** Earnings with no recorded fee (invoices and offline payments). */
  feeUntrackedCount: number;
  /** Estimated PayPal fees to send the payouts. */
  estimatedPayoutFees: number;
  /** Platform cut minus measured inbound fees minus estimated payout fees. */
  estimatedNet: number;
  /** Total number of earnings summarised. */
  earningCount: number;
}

/** Everything the upcoming-payouts panel renders. */
export interface UpcomingPayoutsData {
  /** Pending earnings for instructors who have a payout email saved. */
  payableNow: UpcomingPayoutGroup[];
  /** Pending earnings held back because no payout email is saved. */
  blocked: UpcomingPayoutGroup[];
  /** Earnings already reserved and sent to PayPal, awaiting confirmation. */
  inFlight: UpcomingPayoutGroup[];
  /** Totals across the payable-now bucket. */
  payableTotals: PayoutRevenueTotals;
  /** Instructor amount held back for missing payout setup. */
  blockedTotal: number;
  /** Instructor amount currently in flight at PayPal. */
  inFlightTotal: number;
}

/** One instructor's line inside a past payout batch. */
export interface PayoutHistoryItem {
  id: string;
  instructorId: string;
  instructorName: string;
  recipientEmail: string;
  amount: number;
  status: PayoutItemStatus;
  /** Measured PayPal fee for sending this item, when reported. */
  paypalFeeAmount: number | null;
  errorMessage: string | null;
  /** When an unclaimed payout returns to the business account. */
  unclaimedExpiresAt: string | null;
  deniedAt: string | null;
  denialSource: PayoutDenialSource | null;
  denialReason: string | null;
}

/** A past payout batch with its per-instructor lines. */
export interface PayoutHistoryBatch {
  id: string;
  status: PayoutBatchStatus;
  senderBatchId: string;
  paypalPayoutBatchId: string | null;
  totalAmount: number;
  itemCount: number;
  /** Measured total PayPal fee for the batch, when reported. */
  paypalFeeTotal: number | null;
  errorMessage: string | null;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  deniedAt: string | null;
  denialSource: PayoutDenialSource | null;
  denialReason: string | null;
  /** Who marked it denied, when a human did. */
  deniedByName: string | null;
  /** Internal id of the batch this one retries. */
  retryOfBatchId: string | null;
  /** sender_batch_id of the batch this one retries, for display. */
  retryOfSenderBatchId: string | null;
  /** How many resends deep this batch is (0 for an original). */
  retryDepth: number;
  items: PayoutHistoryItem[];
}
