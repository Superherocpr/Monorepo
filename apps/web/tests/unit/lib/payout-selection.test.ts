/**
 * Unit tests for lib/payout-selection.ts.
 *
 * This decides what money leaves the account, so the cases that matter are the
 * ones where a checkbox could mean the wrong thing: a half-selected instructor,
 * a stale id left over after a send, and fees that apply once per instructor
 * rather than once per ticked class.
 */
import { describe, test, expect } from "vitest";
import {
  allEarningIds,
  groupEarningIds,
  pruneSelection,
  selectedEarningIds,
  selectionState,
  summarizeSelection,
  toggleIds,
} from "@/lib/payout-selection";
import type { UpcomingPayoutGroup, UpcomingPayoutSource } from "@/types/payouts";

const source = (key: string, amount: number, earningIds: string[]): UpcomingPayoutSource => ({
  key,
  kind: "session",
  label: key,
  detail: null,
  sessionDate: null,
  soldCount: earningIds.length,
  grossAmount: amount,
  platformFeeAmount: 0,
  instructorAmount: amount,
  earningIds,
});

const group = (id: string, sources: UpcomingPayoutSource[]): UpcomingPayoutGroup => ({
  instructorId: id,
  instructorName: id,
  instructorEmail: `${id}@example.com`,
  paypalPayoutEmail: `${id}@example.com`,
  grossAmount: 0,
  platformFeeAmount: 0,
  instructorAmount: sources.reduce((s, x) => s + x.instructorAmount, 0),
  earningCount: sources.reduce((s, x) => s + x.earningIds.length, 0),
  estimatedPayoutFee: 0,
  sources,
});

const alex = group("alex", [source("bls", 100, ["e1", "e2"]), source("acls", 50, ["e3"])]);
const blair = group("blair", [source("pals", 80, ["e4"])]);
const FLAT = { kind: "flat", perItem: 0.25, sampleItems: 7 } as const;

describe("earning id collection", () => {
  test("gathers every earning behind an instructor and across instructors", () => {
    expect(groupEarningIds(alex)).toEqual(["e1", "e2", "e3"]);
    expect(allEarningIds([alex, blair])).toEqual(["e1", "e2", "e3", "e4"]);
  });
});

describe("selectionState", () => {
  test("reports none, some and all", () => {
    expect(selectionState(["e1", "e2"], new Set())).toBe("none");
    expect(selectionState(["e1", "e2"], new Set(["e1"]))).toBe("some");
    expect(selectionState(["e1", "e2"], new Set(["e1", "e2", "x"]))).toBe("all");
  });

  test("an empty checkbox is never 'all'", () => {
    expect(selectionState([], new Set(["e1"]))).toBe("none");
  });
});

describe("toggleIds", () => {
  test("ticks everything when none or only some is selected", () => {
    expect([...toggleIds(new Set(), ["e1", "e2"])].sort()).toEqual(["e1", "e2"]);
    expect([...toggleIds(new Set(["e1"]), ["e1", "e2"])].sort()).toEqual(["e1", "e2"]);
  });

  test("unticks everything when all is selected, leaving other selections alone", () => {
    const result = toggleIds(new Set(["e1", "e2", "e4"]), ["e1", "e2"]);
    expect([...result]).toEqual(["e4"]);
  });

  test("does not mutate the set it was given", () => {
    const original = new Set(["e1"]);
    toggleIds(original, ["e2"]);
    expect([...original]).toEqual(["e1"]);
  });
});

describe("pruneSelection", () => {
  test("drops ids that are no longer payable so a stale id is never resubmitted", () => {
    const pruned = pruneSelection(new Set(["e1", "gone"]), [alex]);
    expect([...pruned]).toEqual(["e1"]);
  });

  test("returns the same set when nothing was stale", () => {
    const selected = new Set(["e1"]);
    expect(pruneSelection(selected, [alex])).toBe(selected);
  });
});

describe("summarizeSelection", () => {
  test("totals only what is ticked", () => {
    const result = summarizeSelection([alex, blair], new Set(["e1", "e2", "e4"]), FLAT);
    expect(result).toEqual({
      earningCount: 3,
      instructorCount: 2,
      lineCount: 2,
      instructorTotal: 180,
      estimatedFees: 0.5,
    });
  });

  test("charges one payout fee per instructor however many classes are ticked", () => {
    const result = summarizeSelection([alex], new Set(["e1", "e2", "e3"]), FLAT);
    expect(result.lineCount).toBe(2);
    expect(result.instructorCount).toBe(1);
    expect(result.estimatedFees).toBe(0.25);
  });

  test("a class that is only partly selected is not paid", () => {
    // The smallest thing an admin can tick is a whole class: one student's earning
    // alone must not leak into the total.
    const result = summarizeSelection([alex], new Set(["e1"]), FLAT);
    expect(result.instructorCount).toBe(0);
    expect(result.instructorTotal).toBe(0);
  });

  test("an empty selection pays nothing", () => {
    expect(summarizeSelection([alex, blair], new Set(), FLAT)).toEqual({
      earningCount: 0,
      instructorCount: 0,
      lineCount: 0,
      instructorTotal: 0,
      estimatedFees: 0,
    });
  });
});

describe("selectedEarningIds", () => {
  test("sends exactly the earnings behind fully ticked lines", () => {
    expect(selectedEarningIds([alex, blair], new Set(["e1", "e2", "e4"]))).toEqual([
      "e1",
      "e2",
      "e4",
    ]);
  });

  test("ignores a partly ticked class so what is sent matches the summary", () => {
    expect(selectedEarningIds([alex], new Set(["e1", "e3"]))).toEqual(["e3"]);
  });

  test("sends nothing for an empty selection", () => {
    expect(selectedEarningIds([alex, blair], new Set())).toEqual([]);
  });
});
