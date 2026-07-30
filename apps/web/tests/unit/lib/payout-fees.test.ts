/**
 * Unit tests for lib/payout-fees.ts
 *
 * Covers: estimateInboundFee, estimatePayoutFee, estimatePlatformMargin,
 * breakEvenFeePercent, compareBatchingCost. All functions are pure with no I/O.
 *
 * These estimates drive the break-even warning and the batching cost comparison
 * in payout settings, so the cap behaviour and the loss-making cases matter.
 */
import { describe, test, expect } from "vitest";
import {
  breakEvenFeePercent,
  compareBatchingCost,
  estimateInboundFee,
  estimatePayoutFee,
  estimatePlatformMargin,
  PAYOUT_FEE_CAP,
} from "@/lib/payout-fees";

describe("estimateInboundFee", () => {
  test("applies 2.9% plus 30 cents to a $100 payment", () => {
    expect(estimateInboundFee(100)).toBe(3.2);
  });

  test("applies the same formula to a smaller payment", () => {
    expect(estimateInboundFee(50)).toBe(1.75);
  });

  test("returns 0 for a zero amount", () => {
    expect(estimateInboundFee(0)).toBe(0);
  });

  test("returns 0 for a negative amount", () => {
    expect(estimateInboundFee(-25)).toBe(0);
  });

  test("returns 0 for a non-finite amount", () => {
    expect(estimateInboundFee(Number.NaN)).toBe(0);
  });
});

describe("estimatePayoutFee", () => {
  test("charges 2% below the cap", () => {
    expect(estimatePayoutFee(40)).toBe(0.8);
  });

  test("caps the fee for larger payouts", () => {
    expect(estimatePayoutFee(80)).toBe(PAYOUT_FEE_CAP);
  });

  test("caps regardless of how large the payout is", () => {
    expect(estimatePayoutFee(5000)).toBe(PAYOUT_FEE_CAP);
  });

  test("hits the cap exactly at $50", () => {
    expect(estimatePayoutFee(50)).toBe(1);
  });

  test("returns 0 for a zero amount", () => {
    expect(estimatePayoutFee(0)).toBe(0);
  });
});

describe("estimatePlatformMargin", () => {
  test("a $100 class at 20% nets about $15.80 after both PayPal fees", () => {
    const margin = estimatePlatformMargin(100, 20);
    expect(margin.platformCut).toBe(20);
    expect(margin.inboundFee).toBe(3.2);
    expect(margin.outboundFee).toBe(1);
    expect(margin.netMargin).toBe(15.8);
    expect(margin.netMarginPercent).toBe(15.8);
  });

  test("a low platform fee loses money on every booking", () => {
    const margin = estimatePlatformMargin(100, 3);
    expect(margin.platformCut).toBe(3);
    expect(margin.netMargin).toBeLessThan(0);
  });

  test("clamps a fee percentage above 100", () => {
    const margin = estimatePlatformMargin(100, 150);
    expect(margin.platformFeePercent).toBe(100);
    expect(margin.platformCut).toBe(100);
    // Nothing is paid out, so there is no outbound fee.
    expect(margin.outboundFee).toBe(0);
  });

  test("clamps a negative fee percentage to zero", () => {
    const margin = estimatePlatformMargin(100, -10);
    expect(margin.platformFeePercent).toBe(0);
    expect(margin.platformCut).toBe(0);
  });

  test("reports a null margin percentage for a free class", () => {
    const margin = estimatePlatformMargin(0, 20);
    expect(margin.netMarginPercent).toBeNull();
  });
});

describe("breakEvenFeePercent", () => {
  test("a cheaper class needs a higher percentage to break even", () => {
    const cheap = breakEvenFeePercent(50);
    const pricier = breakEvenFeePercent(100);
    expect(cheap).not.toBeNull();
    expect(pricier).not.toBeNull();
    expect(cheap as number).toBeGreaterThan(pricier as number);
  });

  test("the returned percentage actually breaks even", () => {
    const percent = breakEvenFeePercent(100);
    expect(percent).not.toBeNull();
    expect(estimatePlatformMargin(100, percent as number).netMargin).toBeGreaterThanOrEqual(0);
  });

  test("just below the returned percentage loses money", () => {
    const percent = breakEvenFeePercent(100) as number;
    expect(estimatePlatformMargin(100, percent - 0.2).netMargin).toBeLessThan(0);
  });

  test("returns null for a zero-price class", () => {
    expect(breakEvenFeePercent(0)).toBeNull();
  });
});

describe("compareBatchingCost", () => {
  test("batching one instructor's many small earnings costs far less", () => {
    // Ten $40 earnings: 2% each is under the cap individually, but combined the
    // single payout hits the cap once.
    const comparison = compareBatchingCost([Array.from({ length: 10 }, () => 40)]);
    expect(comparison.earningCount).toBe(10);
    expect(comparison.instructorCount).toBe(1);
    expect(comparison.immediateCost).toBe(8);
    expect(comparison.batchedCost).toBe(1);
    expect(comparison.savings).toBe(7);
  });

  test("a single earning per instructor has no saving", () => {
    const comparison = compareBatchingCost([[40], [60]]);
    expect(comparison.savings).toBe(0);
  });

  test("sums across multiple instructors", () => {
    const comparison = compareBatchingCost([
      [40, 40],
      [10, 10, 10],
    ]);
    expect(comparison.earningCount).toBe(5);
    expect(comparison.instructorCount).toBe(2);
    expect(comparison.savings).toBeGreaterThan(0);
  });

  test("handles an empty input", () => {
    const comparison = compareBatchingCost([]);
    expect(comparison.earningCount).toBe(0);
    expect(comparison.immediateCost).toBe(0);
    expect(comparison.savings).toBe(0);
  });
});
