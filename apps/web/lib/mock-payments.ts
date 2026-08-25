/**
 * Staging-only PayPal bypass for the "Add Student to Class" charge flow
 * (/api/sessions/[id]/charge-and-book, /api/paypal/capture-manual-charge,
 * /api/paypal/create-manual-charge-order, and the mock-status check the
 * modal uses to decide what to render).
 *
 * WHY THIS EXISTS
 *   Staging is configured to run every payment surface against the LIVE
 *   PayPal merchant account — PAYPAL_API_BASE is https://api-m.paypal.com,
 *   the same credentials as production. Testing "Add Student" there charges
 *   a real card for real money. Fixing every payment surface is a bigger,
 *   deliberately deferred change (tracked in the Todoist maintenance
 *   backlog); this module unblocks just the feature built this session.
 *
 * WHAT IT DOES
 *   When active, the server never calls the PayPal API and the client never
 *   loads the PayPal card-fields SDK. A synthesized "settled capture" flows
 *   through the SAME downstream code as a real one — session guards,
 *   book_spot, the payment row — so this exercises real app logic against
 *   fake money, not a separate code path pretending to.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not produce an instructor_earnings row. Staging's payout_trigger
 *   system_setting is "scheduled" (confirmed 2026-08-23): a cron batches and
 *   submits any unbatched earning to real PayPal Payouts on its own timer,
 *   with no "was this charge real" check anywhere in that path. A mock
 *   earning would eventually pay real money to a real PayPal account for a
 *   charge that never happened. There is no later point to gate that on, so
 *   the row is simply never created — see the callers in the routes above.
 *   Confirmation/notification emails are skipped for the same class of
 *   reason: Resend on staging is the same real account, and nobody should
 *   receive "you were charged $75" for a test run.
 *
 * SAFETY
 *   Three independent conditions must ALL hold before any route treats a
 *   request as mocked. Absence of the flag (the production default) changes
 *   nothing about existing behavior; the other two are checked even when the
 *   flag is present, so setting it by mistake outside staging is not enough
 *   on its own to fabricate a charge:
 *     1. MOCK_PAYMENTS=true — must be set on the staging BRANCH's env vars
 *        specifically, never at the Amplify app level. App-level values are
 *        inherited by every branch including production; that inheritance
 *        is exactly how PAYPAL_API_BASE ended up pointed at live money on
 *        staging in the first place (see the note above).
 *     2. NEXT_PUBLIC_BASE_URL is not the literal production domain.
 *     3. NEXT_PUBLIC_SUPABASE_URL is not the literal production project.
 *   (2) and (3) are hard-coded literals, deliberately redundant with (1) — a
 *   single mistaken env var should never be the only thing standing between
 *   this and a fabricated production charge.
 */

import { randomUUID } from "crypto";
import type { CaptureOutcome } from "./paypal";

const PRODUCTION_BASE_URL = "https://superherocpr.com";
const PRODUCTION_SUPABASE_URL = "https://qgvlguifubbnclxfascz.supabase.co";

/** Prefix on every synthetic order/capture id, so a mock transaction is unmistakable wherever it's logged or displayed. */
export const MOCK_ID_PREFIX = "MOCK-";

/**
 * Whether the Add Student charge flow should bypass PayPal entirely.
 * See the file header for the three-condition guard this checks.
 */
export function isMockPaymentsEnabled(): boolean {
  return (
    process.env.MOCK_PAYMENTS === "true" &&
    process.env.NEXT_PUBLIC_BASE_URL !== PRODUCTION_BASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_URL !== PRODUCTION_SUPABASE_URL
  );
}

/** A synthetic PayPal order id for create-manual-charge-order's mock path. */
export function createMockOrderId(): string {
  return `${MOCK_ID_PREFIX}ORDER-${randomUUID()}`;
}

/**
 * A CaptureOutcome shaped exactly like a real settled capture, so every route
 * downstream of evaluateCaptureOutcome() runs unmodified.
 *
 * Fee fields are left null — "not tracked" — rather than fabricated zeros,
 * matching how a real capture that omitted its fee breakdown is already
 * represented (see parseCaptureFees in lib/paypal.ts). A synthetic $0.00 fee
 * would misleadingly read as "PayPal charged nothing", which is a claim this
 * module has no basis to make.
 *
 * @param amount - The instructor/manager-entered charge amount.
 */
export function mockCaptureOutcome(amount: number): CaptureOutcome {
  return {
    settled: true,
    captureId: `${MOCK_ID_PREFIX}CAPTURE-${randomUUID()}`,
    capturedAmount: amount,
    fees: { grossAmount: null, paypalFee: null, netAmount: null },
  };
}
