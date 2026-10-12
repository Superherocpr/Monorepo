/**
 * Unit tests for the batch status badge in PayoutHistoryPanel.
 *
 * A batch whose stored status is `completed` but which still has instructors PayPal
 * returned (or that failed) must read "Partly paid", not "Confirmed paid": the
 * latter beside a note that money came back is misleading, and "Paid manually"
 * settlements make this mixed state common.
 */
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PayoutHistoryBatch, PayoutHistoryItem } from "@/types/payouts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import PayoutHistoryPanel from "@/app/(admin)/_components/PayoutHistoryPanel";

/** Builds a payout item with only the fields the badge logic reads varied. */
function item(status: PayoutHistoryItem["status"], id: string): PayoutHistoryItem {
  return {
    id,
    instructorId: id,
    instructorName: `Instructor ${id}`,
    recipientEmail: `${id}@example.com`,
    amount: 10,
    status,
    paypalFeeAmount: null,
    errorMessage: null,
    unclaimedExpiresAt: null,
    deniedAt: null,
    denialSource: null,
    denialReason: null,
    manualPayment: null,
  };
}

/** Builds a batch with the given status and item statuses. */
function batch(
  status: PayoutHistoryBatch["status"],
  itemStatuses: PayoutHistoryItem["status"][]
): PayoutHistoryBatch {
  return {
    id: "batch-1",
    status,
    senderBatchId: "shcpr-1",
    paypalPayoutBatchId: null,
    totalAmount: 10 * itemStatuses.length,
    itemCount: itemStatuses.length,
    paypalFeeTotal: null,
    errorMessage: null,
    createdAt: "2026-10-12T10:00:00Z",
    submittedAt: null,
    completedAt: null,
    deniedAt: null,
    denialSource: null,
    denialReason: null,
    deniedByName: null,
    retryOfBatchId: null,
    retryOfSenderBatchId: null,
    retryDepth: 0,
    items: itemStatuses.map((s, index) => item(s, `i${index}`)),
  };
}

describe("PayoutHistoryPanel batch badge", () => {
  test("completed batch with a manually paid and a returned instructor reads Partly paid", () => {
    render(<PayoutHistoryPanel batches={[batch("completed", ["manually_paid", "denied"])]} />);
    expect(screen.getByText("Partly paid")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed paid")).not.toBeInTheDocument();
  });

  test("completed batch with a PayPal-paid and a returned instructor reads Partly paid", () => {
    render(<PayoutHistoryPanel batches={[batch("completed", ["completed", "failed"])]} />);
    expect(screen.getByText("Partly paid")).toBeInTheDocument();
  });

  test("a fully paid completed batch still reads Confirmed paid", () => {
    render(<PayoutHistoryPanel batches={[batch("completed", ["completed", "manually_paid"])]} />);
    expect(screen.getByText("Confirmed paid")).toBeInTheDocument();
    expect(screen.queryByText("Partly paid")).not.toBeInTheDocument();
  });

  test("a denied batch is not relabelled", () => {
    render(<PayoutHistoryPanel batches={[batch("denied", ["denied", "denied"])]} />);
    expect(screen.getByText("Denied by PayPal")).toBeInTheDocument();
    expect(screen.queryByText("Partly paid")).not.toBeInTheDocument();
  });

  test("a fully manual batch reads Paid manually", () => {
    render(<PayoutHistoryPanel batches={[batch("manually_paid", ["manually_paid"])]} />);
    expect(screen.getByText("Paid manually")).toBeInTheDocument();
  });
});
