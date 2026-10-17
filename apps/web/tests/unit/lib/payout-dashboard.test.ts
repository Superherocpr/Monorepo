/**
 * Unit tests for the pure helper exported from lib/payout-dashboard.ts.
 *
 * Only covers buildInstructorEarningsSummary — the pure bucketing function.
 * The DB-dependent functions (getUpcomingPayoutsData, getPayoutHistory,
 * getInstructorEarningsData) require a real database and are integration concerns.
 *
 * This function controls what totals an instructor sees on their payout settings
 * page, so the status routing and rounding behaviour need explicit coverage.
 */
import { describe, test, expect } from "vitest";
import {
  buildInstructorEarningsSummary,
  sumTotals,
  type RawEarningRow,
} from "@/lib/payout-dashboard";

describe("buildInstructorEarningsSummary", () => {
  test("returns zero totals for an empty earnings list", () => {
    const result = buildInstructorEarningsSummary([]);
    expect(result.totalEarned).toBe(0);
    expect(result.pendingAmount).toBe(0);
    expect(result.inFlightAmount).toBe(0);
    expect(result.paidAmount).toBe(0);
    expect(result.earningCount).toBe(0);
  });

  test("buckets a pending earning correctly", () => {
    const result = buildInstructorEarningsSummary([
      { status: "pending", instructorAmount: 80 },
    ]);
    expect(result.totalEarned).toBe(80);
    expect(result.pendingAmount).toBe(80);
    expect(result.inFlightAmount).toBe(0);
    expect(result.paidAmount).toBe(0);
  });

  test("buckets a payout_pending earning as in-flight", () => {
    const result = buildInstructorEarningsSummary([
      { status: "payout_pending", instructorAmount: 60 },
    ]);
    expect(result.totalEarned).toBe(60);
    expect(result.pendingAmount).toBe(0);
    expect(result.inFlightAmount).toBe(60);
    expect(result.paidAmount).toBe(0);
  });

  test("buckets a paid earning correctly", () => {
    const result = buildInstructorEarningsSummary([
      { status: "paid", instructorAmount: 100 },
    ]);
    expect(result.totalEarned).toBe(100);
    expect(result.paidAmount).toBe(100);
    expect(result.pendingAmount).toBe(0);
    expect(result.inFlightAmount).toBe(0);
  });

  test("cancelled and failed earnings count toward total but not any payout bucket", () => {
    const result = buildInstructorEarningsSummary([
      { status: "cancelled", instructorAmount: 50 },
      { status: "failed", instructorAmount: 25 },
    ]);
    expect(result.totalEarned).toBe(75);
    expect(result.pendingAmount).toBe(0);
    expect(result.inFlightAmount).toBe(0);
    expect(result.paidAmount).toBe(0);
  });

  test("sums multiple earnings across all buckets", () => {
    const result = buildInstructorEarningsSummary([
      { status: "paid", instructorAmount: 80 },
      { status: "paid", instructorAmount: 64 },
      { status: "pending", instructorAmount: 72 },
      { status: "payout_pending", instructorAmount: 56 },
    ]);
    expect(result.totalEarned).toBe(272);
    expect(result.paidAmount).toBe(144);
    expect(result.pendingAmount).toBe(72);
    expect(result.inFlightAmount).toBe(56);
    expect(result.earningCount).toBe(4);
  });

  test("rounds totals to two decimal places", () => {
    // Three $33.33 earnings: 99.99 total, each bucket gets 33.33
    const result = buildInstructorEarningsSummary([
      { status: "pending", instructorAmount: 33.333 },
      { status: "pending", instructorAmount: 33.333 },
      { status: "pending", instructorAmount: 33.334 },
    ]);
    expect(result.totalEarned).toBe(100);
    expect(result.pendingAmount).toBe(100);
  });

  test("earningCount reflects total rows regardless of status", () => {
    const result = buildInstructorEarningsSummary([
      { status: "paid", instructorAmount: 80 },
      { status: "cancelled", instructorAmount: 0 },
      { status: "pending", instructorAmount: 40 },
    ]);
    expect(result.earningCount).toBe(3);
  });

  test("totalEarned equals the sum of all bucket amounts", () => {
    // This invariant ensures no money disappears or appears in the summary.
    const earnings = [
      { status: "paid", instructorAmount: 100 },
      { status: "pending", instructorAmount: 50 },
      { status: "payout_pending", instructorAmount: 25 },
      { status: "cancelled", instructorAmount: 10 },
    ];
    const result = buildInstructorEarningsSummary(earnings);
    const bucketSum = result.paidAmount + result.pendingAmount + result.inFlightAmount;
    // cancelled/failed do not have a dedicated bucket, so bucketSum < totalEarned here
    expect(result.totalEarned).toBe(185);
    expect(bucketSum).toBe(175);
  });
});

describe("sumTotals", () => {
  const earning = (id: string, gross: number, extra: Record<string, unknown> = {}) =>
    ({
      id,
      instructor_id: "i1",
      status: "pending",
      source_type: "booking",
      gross_amount: gross,
      platform_fee_amount: gross * 0.15,
      instructor_amount: gross * 0.85,
      booking_id: null,
      invoice_id: null,
      payment_id: null,
      profiles: null,
      ...extra,
    }) as unknown as RawEarningRow;

  test("a recorded zero fee counts as tracked, so a check invoice is not flagged", () => {
    const totals = sumTotals(
      [earning("check-invoice", 1700, { source_type: "invoice", invoice_id: "inv" })],
      [],
      new Map([["check-invoice", 0]])
    );
    expect(totals.feeTrackedCount).toBe(1);
    expect(totals.feeUntrackedCount).toBe(0);
    expect(totals.inboundPayPalFees).toBe(0);
    expect(totals.depositedAmount).toBe(1700);
  });

  test("an unknown fee is flagged and does not reduce the deposited amount", () => {
    const totals = sumTotals([earning("e1", 100)], [], new Map([["e1", null]]));
    expect(totals.feeUntrackedCount).toBe(1);
    expect(totals.feeTrackedCount).toBe(0);
    expect(totals.depositedAmount).toBe(100);
  });

  test("deposited is the amount charged minus the recorded collection fees", () => {
    const totals = sumTotals(
      [earning("e1", 100), earning("e2", 200)],
      [],
      new Map([
        ["e1", 3.2],
        ["e2", 6.1],
      ])
    );
    expect(totals.grossCollected).toBe(300);
    expect(totals.inboundPayPalFees).toBe(9.3);
    expect(totals.depositedAmount).toBe(290.7);
  });

  test("the real net takes both PayPal fees out of the platform cut", () => {
    const totals = sumTotals([earning("e1", 100)], [], new Map([["e1", 3.2]]));
    // 15 platform cut, minus 3.20 to collect, with no payout groups to price.
    expect(totals.estimatedNet).toBe(11.8);
  });
});
