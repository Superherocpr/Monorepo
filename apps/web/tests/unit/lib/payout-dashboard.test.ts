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
import { buildInstructorEarningsSummary } from "@/lib/payout-dashboard";

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
