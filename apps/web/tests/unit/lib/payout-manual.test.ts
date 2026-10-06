/**
 * Unit tests for lib/payout-manual.ts: request validation and RPC failure wording
 * for manual payout settlement.
 *
 * The validation is the first of several guards against recording money as paid
 * that was not (or paying an instructor twice), so each rejection is pinned.
 */
import { describe, test, expect } from "vitest";
import {
  describeManualRpcFailure,
  formatManualPaidOn,
  isIsoDate,
  parseDollarAmount,
  parseManualSettleBody,
  parseManualVoidBody,
} from "@/lib/payout-manual";

const VALID_SETTLE = {
  batchId: "batch-1",
  itemId: "item-1",
  method: "zelle",
  reference: "ZEL-4471",
  paidOn: "2026-10-05",
  amount: 125.5,
  note: "Paid from the business account",
  confirmSenderBatchId: "shcpr-abc",
};

describe("parseDollarAmount", () => {
  test.each([
    [125.5, 125.5],
    ["125.50", 125.5],
    ["125", 125],
    ["0.01", 0.01],
  ])("accepts %s", (input, expected) => {
    expect(parseDollarAmount(input)).toBe(expected);
  });

  test.each(["", "abc", "-5", "0", "0.00", "12.345", "1,000", "12.", null, undefined, NaN])(
    "rejects %s",
    (input) => {
      expect(parseDollarAmount(input)).toBeNull();
    }
  );
});

describe("isIsoDate", () => {
  test("accepts a real date", () => {
    expect(isIsoDate("2026-10-05")).toBe(true);
  });

  test.each(["2026-02-31", "2026-13-01", "10/05/2026", "2026-1-5", "", "not a date"])(
    "rejects %s",
    (value) => {
      expect(isIsoDate(value)).toBe(false);
    }
  );
});

describe("formatManualPaidOn", () => {
  test("shows the calendar day regardless of timezone", () => {
    expect(formatManualPaidOn("2026-10-05")).toBe("Oct 5, 2026");
  });

  test("returns the raw string when it is not a date", () => {
    expect(formatManualPaidOn("garbage")).toBe("garbage");
  });
});

describe("parseManualSettleBody", () => {
  test("accepts a complete body and trims strings", () => {
    const result = parseManualSettleBody({ ...VALID_SETTLE, reference: "  ZEL-4471  " });
    expect(result).toEqual({
      ok: true,
      value: {
        batchId: "batch-1",
        itemId: "item-1",
        method: "zelle",
        reference: "ZEL-4471",
        paidOn: "2026-10-05",
        amount: 125.5,
        note: "Paid from the business account",
        confirmSenderBatchId: "shcpr-abc",
      },
    });
  });

  test("accepts the amount as a string and a missing note", () => {
    const result = parseManualSettleBody({ ...VALID_SETTLE, amount: "125.50", note: undefined });
    expect(result.ok && result.value.amount).toBe(125.5);
    expect(result.ok && result.value.note).toBeNull();
  });

  test.each([
    ["a non-object body", null],
    ["an array body", []],
    ["a missing batch id", { ...VALID_SETTLE, batchId: undefined }],
    ["a missing item id", { ...VALID_SETTLE, itemId: "  " }],
    ["an unknown method", { ...VALID_SETTLE, method: "bitcoin" }],
    ["a missing method", { ...VALID_SETTLE, method: undefined }],
    ["a blank reference", { ...VALID_SETTLE, reference: "   " }],
    ["an over-long reference", { ...VALID_SETTLE, reference: "x".repeat(201) }],
    ["an impossible date", { ...VALID_SETTLE, paidOn: "2026-02-31" }],
    ["a missing date", { ...VALID_SETTLE, paidOn: undefined }],
    ["a zero amount", { ...VALID_SETTLE, amount: 0 }],
    ["a three-decimal amount", { ...VALID_SETTLE, amount: "12.345" }],
    ["an over-long note", { ...VALID_SETTLE, note: "n".repeat(1001) }],
    ["no typed confirmation", { ...VALID_SETTLE, confirmSenderBatchId: "" }],
  ])("rejects %s", (_label, body) => {
    const result = parseManualSettleBody(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});

describe("parseManualVoidBody", () => {
  test("accepts an item id and a reason", () => {
    expect(parseManualVoidBody({ itemId: "item-1", reason: " typo " })).toEqual({
      ok: true,
      value: { itemId: "item-1", reason: "typo" },
    });
  });

  test.each([
    ["no reason", { itemId: "item-1" }],
    ["a blank reason", { itemId: "item-1", reason: "  " }],
    ["no item", { reason: "typo" }],
    ["a non-object", "nope"],
  ])("rejects %s", (_label, body) => {
    expect(parseManualVoidBody(body).ok).toBe(false);
  });
});

describe("describeManualRpcFailure", () => {
  test("in-flight items explain the double-payment risk", () => {
    const result = describeManualRpcFailure({
      success: false,
      reason: "item_not_settleable",
      status: "unclaimed",
    });
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/twice/);
  });

  test("needs_review points the admin at Release first", () => {
    const result = describeManualRpcFailure({
      success: false,
      reason: "item_not_settleable",
      status: "needs_review",
    });
    expect(result.error).toMatch(/Release/);
  });

  test("moved-on earnings are refused with a conflict", () => {
    expect(describeManualRpcFailure({ success: false, reason: "earnings_changed" }).status).toBe(409);
  });

  test("amount mismatch tells the admin what is owed", () => {
    const result = describeManualRpcFailure({
      success: false,
      reason: "amount_mismatch",
      expected: "125.50",
    });
    expect(result.status).toBe(400);
    expect(result.error).toContain("$125.50");
  });

  test("an unknown reason gets a generic message and leaks nothing", () => {
    const result = describeManualRpcFailure({ success: false, reason: "some_internal_thing" });
    expect(result.error).toBe("This payout could not be updated.");
  });
});
