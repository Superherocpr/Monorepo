/**
 * PayPal fee estimation for payout forecasting and settings guidance.
 *
 * Actual fees are always read from PayPal and stored (payments.paypal_fee_amount
 * inbound, instructor_payout_items.paypal_fee_amount outbound). These functions
 * exist only for money that has not moved yet — forecasting what an upcoming
 * payout will cost, and showing what a platform-fee percentage actually nets.
 * Anything derived from them must be labelled as an estimate in the UI.
 *
 * Rates are PayPal's published US domestic rates. An account on negotiated
 * pricing will differ, which is exactly why measured fees are preferred wherever
 * they exist.
 */

/** Percentage PayPal takes on a standard US commercial transaction. */
export const INBOUND_FEE_PERCENT = 2.9;

/** Fixed per-transaction fee PayPal adds on a US commercial transaction. */
export const INBOUND_FEE_FIXED = 0.3;

/** Percentage PayPal charges to send a US domestic payout. */
export const PAYOUT_FEE_PERCENT = 2;

/** Maximum PayPal charges for a single US domestic payout item. */
export const PAYOUT_FEE_CAP = 1;

/** Rounds a dollar amount to two decimal places using cents math. */
function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Estimates PayPal's processing fee on money coming in.
 * @param grossAmount - Amount charged to the customer.
 * @returns Estimated fee in dollars, 0 for a non-positive amount.
 */
export function estimateInboundFee(grossAmount: number): number {
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) return 0;
  return roundCurrency(grossAmount * (INBOUND_FEE_PERCENT / 100) + INBOUND_FEE_FIXED);
}

/**
 * Estimates PayPal's fee to send one payout item.
 *
 * The cap is per payout item — per recipient, not per booking — which is why
 * batching several earnings for one instructor into a single item costs less
 * than sending each one separately.
 *
 * @param amount - Amount being sent to one recipient.
 * @returns Estimated fee in dollars, 0 for a non-positive amount.
 */
export function estimatePayoutFee(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return roundCurrency(Math.min(amount * (PAYOUT_FEE_PERCENT / 100), PAYOUT_FEE_CAP));
}

/** What a single class booking actually nets the platform. */
export interface PlatformMarginEstimate {
  /** Price charged to the customer. */
  grossAmount: number;
  /** Platform fee percentage applied. */
  platformFeePercent: number;
  /** Gross platform cut before any PayPal fees. */
  platformCut: number;
  /** Estimated fee to collect the payment. */
  inboundFee: number;
  /** Estimated fee to send the instructor their share. */
  outboundFee: number;
  /** Platform cut after both PayPal fees — the real margin. */
  netMargin: number;
  /** Net margin as a percentage of gross, or null when gross is zero. */
  netMarginPercent: number | null;
}

/**
 * Estimates what the platform actually keeps on one booking after PayPal.
 *
 * Both PayPal fees currently come out of the platform's cut — the instructor
 * receives their full percentage of gross — so a low platform fee percentage can
 * net less than nothing. This is what makes the break-even readout in payout
 * settings worth showing.
 *
 * @param grossAmount - Price charged to the customer.
 * @param platformFeePercent - Percentage the platform retains.
 * @returns The full breakdown from gross to real net margin.
 */
export function estimatePlatformMargin(
  grossAmount: number,
  platformFeePercent: number
): PlatformMarginEstimate {
  const safeGross = Number.isFinite(grossAmount) ? Math.max(0, grossAmount) : 0;
  const safePercent = Number.isFinite(platformFeePercent)
    ? Math.min(100, Math.max(0, platformFeePercent))
    : 0;

  const platformCut = roundCurrency(safeGross * (safePercent / 100));
  const instructorShare = roundCurrency(safeGross - platformCut);
  const inboundFee = estimateInboundFee(safeGross);
  const outboundFee = estimatePayoutFee(instructorShare);
  const netMargin = roundCurrency(platformCut - inboundFee - outboundFee);

  return {
    grossAmount: safeGross,
    platformFeePercent: safePercent,
    platformCut,
    inboundFee,
    outboundFee,
    netMargin,
    netMarginPercent: safeGross > 0 ? roundCurrency((netMargin / safeGross) * 100) : null,
  };
}

/**
 * Finds the platform fee percentage at which a class of a given price breaks even.
 *
 * Below this percentage the platform loses money on every booking. It rises as
 * class price falls, because PayPal's fixed per-transaction fee is a larger share
 * of a smaller sale.
 *
 * @param grossAmount - Price charged to the customer.
 * @returns Break-even percentage, or null when the price is zero or the fees can
 *          never be covered even at a 100% platform fee.
 */
export function breakEvenFeePercent(grossAmount: number): number | null {
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) return null;

  // Walk upwards in 0.1% steps — the outbound fee cap makes this piecewise, so a
  // closed-form solution would be wrong for exactly the small-class case that
  // matters most here.
  for (let percent = 0; percent <= 100; percent += 0.1) {
    if (estimatePlatformMargin(grossAmount, percent).netMargin >= 0) {
      return roundCurrency(percent);
    }
  }
  return null;
}

/** Cost comparison between paying instructors per transaction versus batched. */
export interface BatchingCostComparison {
  /** Number of separate earnings involved. */
  earningCount: number;
  /** Number of distinct instructors those earnings belong to. */
  instructorCount: number;
  /** Estimated payout fees when every earning is sent on its own. */
  immediateCost: number;
  /** Estimated payout fees when each instructor receives one combined payout. */
  batchedCost: number;
  /** What batching saves. */
  savings: number;
}

/**
 * Estimates how much more "immediate" payout mode costs than batching.
 *
 * In immediate mode each payment triggers its own batch, so PayPal's per-item fee
 * applies to every single booking. Batched modes combine an instructor's earnings
 * into one payout item and pay the capped fee once.
 *
 * @param amountsByInstructor - Each instructor's individual earning amounts.
 * @returns Estimated cost both ways and the difference.
 */
export function compareBatchingCost(
  amountsByInstructor: number[][]
): BatchingCostComparison {
  let immediateCost = 0;
  let batchedCost = 0;
  let earningCount = 0;

  for (const amounts of amountsByInstructor) {
    for (const amount of amounts) {
      immediateCost += estimatePayoutFee(amount);
      earningCount += 1;
    }
    const combined = amounts.reduce((sum, amount) => sum + amount, 0);
    batchedCost += estimatePayoutFee(combined);
  }

  return {
    earningCount,
    instructorCount: amountsByInstructor.length,
    immediateCost: roundCurrency(immediateCost),
    batchedCost: roundCurrency(batchedCost),
    savings: roundCurrency(immediateCost - batchedCost),
  };
}
