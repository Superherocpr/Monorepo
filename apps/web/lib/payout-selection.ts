/**
 * Pure helpers for choosing which instructors and classes to pay out.
 *
 * The admin ticks instructors or individual classes/invoices on the payouts page.
 * Selection is held as a set of EARNING ids, because that is exactly what the
 * server reserves: ticking a class selects every earning behind it, ticking an
 * instructor selects all of theirs. No I/O, so it is unit tested directly.
 */

import { estimatePayoutFee } from "@/lib/payout-fees";
import type {
  PayoutFeeModel,
  UpcomingPayoutGroup,
  UpcomingPayoutSource,
} from "@/types/payouts";

/** The selection and how to change it, handed to a panel that shows checkboxes. */
export interface PayoutSelection {
  /** Earning ids currently ticked. */
  selected: Set<string>;
  /** Called with the new selection whenever a checkbox changes. */
  onChange: (next: Set<string>) => void;
}

/** Tri-state used by checkboxes that cover several earnings. */
export type SelectionState = "none" | "some" | "all";

/** What the current selection would pay, shown before the admin confirms. */
export interface SelectionSummary {
  /** Earnings (individual payments) that would be reserved. */
  earningCount: number;
  /** Instructors who would receive a payout. */
  instructorCount: number;
  /** Class and invoice lines included. */
  lineCount: number;
  /** Total the instructors would receive. */
  instructorTotal: number;
  /** Estimated PayPal fees to send those payouts (one per instructor). */
  estimatedFees: number;
}

/** Rounds a dollar amount to cents. */
function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Every earning id behind one instructor's payout.
 * @param group - The instructor's upcoming payout.
 * @returns All earning ids across the instructor's classes and invoices.
 */
export function groupEarningIds(group: UpcomingPayoutGroup): string[] {
  return group.sources.flatMap((source) => source.earningIds);
}

/**
 * Every earning id across a set of instructors.
 * @param groups - Instructor payouts, typically the payable-now bucket.
 * @returns All earning ids.
 */
export function allEarningIds(groups: UpcomingPayoutGroup[]): string[] {
  return groups.flatMap(groupEarningIds);
}

/**
 * How much of a set of earnings is currently selected.
 * @param ids - The earning ids a checkbox covers.
 * @param selected - The current selection.
 * @returns "all", "some" (partly selected), or "none". An empty list is "none".
 */
export function selectionState(ids: string[], selected: Set<string>): SelectionState {
  if (ids.length === 0) return "none";
  const count = ids.filter((id) => selected.has(id)).length;
  if (count === 0) return "none";
  return count === ids.length ? "all" : "some";
}

/**
 * Flips a checkbox: unticking when everything it covers is selected, otherwise
 * ticking all of it (so a half-selected instructor becomes fully selected).
 * @param selected - The current selection (not mutated).
 * @param ids - The earning ids the clicked checkbox covers.
 * @returns A new selection set.
 */
export function toggleIds(selected: Set<string>, ids: string[]): Set<string> {
  const next = new Set(selected);
  if (selectionState(ids, selected) === "all") {
    for (const id of ids) next.delete(id);
  } else {
    for (const id of ids) next.add(id);
  }
  return next;
}

/**
 * Drops selected ids that no longer exist in the payable list. After a send the
 * page refreshes; without this a stale id would be resubmitted on the next click.
 * @param selected - The current selection.
 * @param groups - The payable instructors as they now stand.
 * @returns The selection restricted to ids still payable.
 */
export function pruneSelection(
  selected: Set<string>,
  groups: UpcomingPayoutGroup[]
): Set<string> {
  const valid = new Set(allEarningIds(groups));
  const next = new Set<string>();
  for (const id of selected) if (valid.has(id)) next.add(id);
  return next.size === selected.size ? selected : next;
}

/**
 * The earning ids to actually send: those behind fully ticked lines only.
 *
 * A line is the smallest thing an admin can tick, so a stray id that covers only
 * part of a class is ignored. This keeps what is sent identical to what the
 * summary showed.
 *
 * @param groups - The payable instructors.
 * @param selected - The current selection.
 * @returns Earning ids for every fully selected class or invoice.
 */
export function selectedEarningIds(
  groups: UpcomingPayoutGroup[],
  selected: Set<string>
): string[] {
  return groups.flatMap((group) =>
    group.sources
      .filter((source) => selectionState(source.earningIds, selected) === "all")
      .flatMap((source) => source.earningIds)
  );
}

/**
 * Totals what the current selection would pay.
 *
 * A line (class or invoice) is the smallest thing the admin can tick, so amounts
 * are summed per line. One PayPal fee applies per instructor however many of
 * their lines are ticked, which is why fees are estimated on the combined amount.
 *
 * @param groups - The payable instructors.
 * @param selected - The current selection.
 * @param feeModel - How PayPal charges this account to send a payout.
 * @returns Counts, the total payable, and the estimated fees.
 */
export function summarizeSelection(
  groups: UpcomingPayoutGroup[],
  selected: Set<string>,
  feeModel: PayoutFeeModel
): SelectionSummary {
  let earningCount = 0;
  let instructorCount = 0;
  let lineCount = 0;
  let instructorTotal = 0;
  let estimatedFees = 0;

  for (const group of groups) {
    const chosen: UpcomingPayoutSource[] = group.sources.filter(
      (source) => selectionState(source.earningIds, selected) === "all"
    );
    if (chosen.length === 0) continue;

    const amount = chosen.reduce((sum, source) => sum + source.instructorAmount, 0);
    instructorCount += 1;
    lineCount += chosen.length;
    earningCount += chosen.reduce((sum, source) => sum + source.earningIds.length, 0);
    instructorTotal += amount;
    estimatedFees += estimatePayoutFee(roundCurrency(amount), feeModel);
  }

  return {
    earningCount,
    instructorCount,
    lineCount,
    instructorTotal: roundCurrency(instructorTotal),
    estimatedFees: roundCurrency(estimatedFees),
  };
}
