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

import type { PayoutFeeModel } from "@/types/payouts";

/** PayPal's standard US rate, used until the account has batches to learn from. */
export const PUBLISHED_PAYOUT_FEE_MODEL: PayoutFeeModel = { kind: "published" };

/** Per-item fees within this many dollars of each other count as the same flat fee. */
const FLAT_FEE_TOLERANCE = 0.011;

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

/** A batch's reported fee next to the number of payout items it covered. */
export interface PayoutFeeObservation {
  /** Total fee PayPal reported on the batch header. */
  feeTotal: number;
  /** Payout items in that batch. */
  itemCount: number;
}

/**
 * Learns how PayPal charges this account from the fees it has already reported.
 *
 * PayPal's published payout rate is 2% capped at $1, but this account's batches
 * report a constant fee per item regardless of amount, so the published rate
 * overstates the cost. When every observed batch implies the same per-item fee
 * the account is treated as flat-rate; if they disagree, or there is nothing to
 * learn from, the published rate is used instead of guessing.
 *
 * @param observations - Batch fee totals with their item counts.
 * @returns A flat per-item model, or the published model.
 */
export function derivePayoutFeeModel(
  observations: PayoutFeeObservation[]
): PayoutFeeModel {
  const perItem = observations
    .filter((o) => o.itemCount > 0 && Number.isFinite(o.feeTotal) && o.feeTotal > 0)
    .map((o) => ({ fee: o.feeTotal / o.itemCount, items: o.itemCount }));
  if (perItem.length === 0) return PUBLISHED_PAYOUT_FEE_MODEL;

  const fees = perItem.map((o) => o.fee).sort((a, b) => a - b);
  if (fees[fees.length - 1] - fees[0] > FLAT_FEE_TOLERANCE) {
    return PUBLISHED_PAYOUT_FEE_MODEL;
  }

  const median = fees[Math.floor(fees.length / 2)];
  return {
    kind: "flat",
    perItem: roundCurrency(median),
    sampleItems: perItem.reduce((sum, o) => sum + o.items, 0),
  };
}

/**
 * Estimates PayPal's fee to send one payout item.
 *
 * Fees are per payout item, per recipient and not per booking, which is why
 * batching several earnings for one instructor into a single item costs less
 * than sending each one separately.
 *
 * @param amount - Amount being sent to one recipient.
 * @param model - How this account is charged; defaults to PayPal's published rate.
 * @returns Estimated fee in dollars, 0 for a non-positive amount.
 */
export function estimatePayoutFee(
  amount: number,
  model: PayoutFeeModel = PUBLISHED_PAYOUT_FEE_MODEL
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (model.kind === "flat") return roundCurrency(model.perItem);
  return roundCurrency(Math.min(amount * (PAYOUT_FEE_PERCENT / 100), PAYOUT_FEE_CAP));
}

/**
 * Plain-English description of how payout fees were estimated, for the UI.
 * @param model - The model in use.
 * @returns A sentence fragment with no trailing period.
 */
export function describePayoutFeeModel(model: PayoutFeeModel): string {
  if (model.kind === "flat") {
    const items = model.sampleItems;
    return `$${model.perItem.toFixed(2)} per payout, the fee PayPal reported on your last ${items} payout item${items === 1 ? "" : "s"}`;
  }
  return "PayPal's standard US rate of 2% per payout, capped at $1, because there are no PayPal payout fees on record yet";
}

/** Payout item statuses where PayPal did not deliver the money. */
const UNDELIVERED_ITEM_STATUSES = new Set(["denied", "failed"]);

/**
 * Decides how a recorded payout fee should read in the history tables.
 *
 * A denied or failed payout returns the money, and PayPal reports $0.00 on its
 * items even though the batch header still quotes the would-be fee, so showing
 * the header figure would suggest a cost that was never charged. A payout paid by
 * hand never went through PayPal Payouts at all.
 *
 * @param status - Item or batch status.
 * @param fee - The recorded fee, or null when none is recorded.
 * @returns What to render: an amount, or a short label.
 */
export function describePayoutFee(
  status: string,
  fee: number | null
): { kind: "amount"; amount: number } | { kind: "label"; text: string } {
  if (UNDELIVERED_ITEM_STATUSES.has(status)) return { kind: "label", text: "Not charged" };
  if (status === "manually_paid") return { kind: "label", text: "None (paid by hand)" };
  if (fee === null) return { kind: "label", text: "Pending" };
  return { kind: "amount", amount: fee };
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
 * @param model - How payout fees are charged on this account.
 * @returns The full breakdown from gross to real net margin.
 */
export function estimatePlatformMargin(
  grossAmount: number,
  platformFeePercent: number,
  model: PayoutFeeModel = PUBLISHED_PAYOUT_FEE_MODEL
): PlatformMarginEstimate {
  const safeGross = Number.isFinite(grossAmount) ? Math.max(0, grossAmount) : 0;
  const safePercent = Number.isFinite(platformFeePercent)
    ? Math.min(100, Math.max(0, platformFeePercent))
    : 0;

  const platformCut = roundCurrency(safeGross * (safePercent / 100));
  const instructorShare = roundCurrency(safeGross - platformCut);
  const inboundFee = estimateInboundFee(safeGross);
  const outboundFee = estimatePayoutFee(instructorShare, model);
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
 * @param model - How payout fees are charged on this account.
 * @returns Break-even percentage, or null when the price is zero or the fees can
 *          never be covered even at a 100% platform fee.
 */
export function breakEvenFeePercent(
  grossAmount: number,
  model: PayoutFeeModel = PUBLISHED_PAYOUT_FEE_MODEL
): number | null {
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) return null;

  // Walk upwards in 0.1% steps — the outbound fee cap makes this piecewise, so a
  // closed-form solution would be wrong for exactly the small-class case that
  // matters most here.
  for (let percent = 0; percent <= 100; percent += 0.1) {
    if (estimatePlatformMargin(grossAmount, percent, model).netMargin >= 0) {
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
 * @param model - How payout fees are charged on this account.
 * @returns Estimated cost both ways and the difference.
 */
export function compareBatchingCost(
  amountsByInstructor: number[][],
  model: PayoutFeeModel = PUBLISHED_PAYOUT_FEE_MODEL
): BatchingCostComparison {
  let immediateCost = 0;
  let batchedCost = 0;
  let earningCount = 0;

  for (const amounts of amountsByInstructor) {
    for (const amount of amounts) {
      immediateCost += estimatePayoutFee(amount, model);
      earningCount += 1;
    }
    const combined = amounts.reduce((sum, amount) => sum + amount, 0);
    batchedCost += estimatePayoutFee(combined, model);
  }

  return {
    earningCount,
    instructorCount: amountsByInstructor.length,
    immediateCost: roundCurrency(immediateCost),
    batchedCost: roundCurrency(batchedCost),
    savings: roundCurrency(immediateCost - batchedCost),
  };
}
