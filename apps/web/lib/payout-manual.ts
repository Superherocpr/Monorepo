/**
 * Manual payout settlement: request validation and RPC-result wording.
 *
 * PayPal has been denying payout batches, so a super_admin pays instructors by
 * hand (Zelle, check, ...) and records it against the denied payout item. The
 * money-moving work happens in the record_manual_payout_item() RPC (migration
 * 0075); this module holds the pure parts shared by the settle route, the void
 * route and their tests: parsing the request body, and turning the RPC's
 * machine-readable `reason` into a sentence an admin can act on.
 *
 * Pure functions only, so it is safe to import anywhere and unit-testable
 * without a database or PayPal.
 */

import {
  MANUAL_PAYOUT_METHODS,
  type ManualPayoutMethod,
} from "@/types/payouts";

/** Longest reference or note accepted; keeps junk out of the audit trail. */
const MAX_REFERENCE_LENGTH = 200;
const MAX_NOTE_LENGTH = 1000;

/** A validated settle request, ready to hand to the RPC. */
export interface ManualSettleInput {
  batchId: string;
  itemId: string;
  method: ManualPayoutMethod;
  reference: string;
  /** YYYY-MM-DD */
  paidOn: string;
  /** Dollars, two decimals. Must equal the item amount; the RPC enforces that. */
  amount: number;
  note: string | null;
  /** The batch's sender_batch_id typed back by the admin. */
  confirmSenderBatchId: string;
}

/** A validated void request. */
export interface ManualVoidInput {
  itemId: string;
  reason: string;
}

/** Either a parsed value or a message safe to show the admin. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Reads a trimmed non-empty string from an unknown value. */
function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Type guard for a plain JSON object body. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is one of the allowed manual payment methods. */
export function isManualPayoutMethod(value: unknown): value is ManualPayoutMethod {
  return (
    typeof value === "string" &&
    (MANUAL_PAYOUT_METHODS as readonly string[]).includes(value)
  );
}

/**
 * Whether a string is a real calendar date in YYYY-MM-DD form.
 * Round-trips through Date so "2026-02-31" is rejected instead of rolling over.
 * @param value - Candidate date string.
 */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Parses a dollar amount from a number or numeric string into whole cents-safe
 * dollars. Rejects NaN, zero, negatives and more than two decimal places, so a
 * typo like 12.345 cannot silently round into a match.
 * @param value - Raw amount from the request body.
 * @returns The amount in dollars, or null when invalid.
 */
export function parseDollarAmount(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : readString(value);
  if (text === null || !/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

/**
 * Validates the body of POST /api/payouts/manual-settle.
 * @param body - Parsed JSON request body (unknown shape).
 * @returns The typed input, or an error message for the admin.
 */
export function parseManualSettleBody(body: unknown): ParseResult<ManualSettleInput> {
  if (!isRecord(body)) return { ok: false, error: "Invalid request body." };

  const batchId = readString(body.batchId);
  const itemId = readString(body.itemId);
  if (!batchId || !itemId) return { ok: false, error: "Missing batchId or itemId." };

  if (!isManualPayoutMethod(body.method)) {
    return { ok: false, error: "Choose how the instructor was paid." };
  }

  const reference = readString(body.reference);
  if (!reference) {
    return { ok: false, error: "A payment reference is required (confirmation number, check number, or a short description)." };
  }
  if (reference.length > MAX_REFERENCE_LENGTH) {
    return { ok: false, error: `Reference must be ${MAX_REFERENCE_LENGTH} characters or fewer.` };
  }

  const paidOn = readString(body.paidOn);
  if (!paidOn || !isIsoDate(paidOn)) {
    return { ok: false, error: "Enter the date the payment was sent." };
  }

  const amount = parseDollarAmount(body.amount);
  if (amount === null) {
    return { ok: false, error: "Enter the amount paid in dollars, for example 125.50." };
  }

  const note = readString(body.note);
  if (note && note.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` };
  }

  const confirmSenderBatchId = readString(body.confirmSenderBatchId);
  if (!confirmSenderBatchId) {
    return { ok: false, error: "Type the batch id to confirm." };
  }

  return {
    ok: true,
    value: {
      batchId,
      itemId,
      method: body.method,
      reference,
      paidOn,
      amount,
      note,
      confirmSenderBatchId,
    },
  };
}

/**
 * Validates the body of POST /api/payouts/manual-void.
 * @param body - Parsed JSON request body (unknown shape).
 * @returns The typed input, or an error message for the admin.
 */
export function parseManualVoidBody(body: unknown): ParseResult<ManualVoidInput> {
  if (!isRecord(body)) return { ok: false, error: "Invalid request body." };

  const itemId = readString(body.itemId);
  if (!itemId) return { ok: false, error: "Missing itemId." };

  const reason = readString(body.reason);
  if (!reason) return { ok: false, error: "Say why this payment record is being undone." };
  if (reason.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `Reason must be ${MAX_NOTE_LENGTH} characters or fewer.` };
  }

  return { ok: true, value: { itemId, reason } };
}

/**
 * Formats a date-only payment date (YYYY-MM-DD) for display, e.g. "Oct 5, 2026".
 * Pinned to UTC so the calendar day never shifts with the viewer's timezone;
 * the date is a plain day, not an instant.
 * @param isoDate - Date in YYYY-MM-DD form.
 */
export function formatManualPaidOn(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Shape of the JSON the settle/void RPCs return. */
export interface ManualRpcResult {
  success: boolean;
  reason?: string;
  status?: string;
  expected?: number | string;
  moved?: number;
}

/** Type guard for RPC results. */
export function isManualRpcResult(value: unknown): value is ManualRpcResult {
  return isRecord(value) && typeof value.success === "boolean";
}

/**
 * Turns a refused RPC result into a sentence an admin can act on, plus the HTTP
 * status the route should return. Unknown reasons fall back to a generic message
 * rather than leaking internals.
 * @param result - The RPC result with success = false.
 */
export function describeManualRpcFailure(result: ManualRpcResult): {
  status: number;
  error: string;
} {
  switch (result.reason) {
    case "item_not_found":
      return { status: 404, error: "Payout item not found in this batch." };
    case "already_manually_paid":
      return { status: 409, error: "This payout is already recorded as paid manually." };
    case "item_not_settleable": {
      const detail =
        result.status === "needs_review"
          ? "Its outcome is unknown. Check PayPal, then use Release on the batch first; once it shows as failed you can record the payment."
          : result.status === "completed"
            ? "PayPal already confirmed it as paid."
            : "PayPal may still deliver it, so recording a manual payment now could pay the instructor twice. Wait until PayPal returns or denies it.";
      return { status: 409, error: `This payout cannot be recorded as paid manually. ${detail}` };
    }
    case "no_attempt_history":
      return {
        status: 409,
        error: "This batch predates attempt tracking, so its earnings cannot be matched safely.",
      };
    case "earnings_changed":
      return {
        status: 409,
        error:
          "Some of this payout's earnings have already moved on (paid, or included in a newer payout). Recording it again would pay them twice. Check the newer batch instead.",
      };
    case "earnings_locked":
      return {
        status: 409,
        error: "A payout is being processed for these earnings right now. Try again in a minute.",
      };
    case "item_total_mismatch":
      return {
        status: 409,
        error: "This item's amount does not match its earnings. Contact support before recording it.",
      };
    case "amount_mismatch":
      return {
        status: 400,
        error: `The amount must equal what is owed (${formatExpected(result.expected)}). If you paid a different amount, resolve that outside the system first.`,
      };
    case "invalid_paid_on":
      return { status: 400, error: "The payment date cannot be in the future." };
    case "reference_required":
      return { status: 400, error: "A payment reference is required." };
    case "reason_required":
      return { status: 400, error: "Say why this payment record is being undone." };
    case "not_manually_paid":
      return { status: 409, error: "This payout is not recorded as paid manually." };
    default:
      return { status: 400, error: "This payout could not be updated." };
  }
}

/** Formats the `expected` amount from an RPC result for display. */
function formatExpected(expected: number | string | undefined): string {
  const amount = Number(expected);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "the item total";
}
