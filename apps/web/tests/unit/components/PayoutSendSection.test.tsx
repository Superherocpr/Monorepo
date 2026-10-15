/**
 * Unit tests for PayoutSendSection: choosing which instructors and classes to pay.
 *
 * This is the screen that moves money, so the tests drive it the way an admin
 * would and assert on what is actually sent to the server: nothing without a
 * confirmation, only the ticked classes, and everything for Pay all.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { UpcomingPayoutGroup, UpcomingPayoutsData } from "@/types/payouts";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import PayoutSendSection from "@/app/(admin)/_components/PayoutSendSection";

const group = (
  id: string,
  name: string,
  sources: Array<{ key: string; label: string; amount: number; ids: string[] }>
): UpcomingPayoutGroup => ({
  instructorId: id,
  instructorName: name,
  instructorEmail: `${id}@example.com`,
  paypalPayoutEmail: `${id}@paypal.example.com`,
  grossAmount: 0,
  platformFeeAmount: 0,
  instructorAmount: sources.reduce((s, x) => s + x.amount, 0),
  earningCount: sources.reduce((s, x) => s + x.ids.length, 0),
  estimatedPayoutFee: 0.25,
  sources: sources.map((s) => ({
    key: s.key,
    kind: "session" as const,
    label: s.label,
    detail: null,
    sessionDate: null,
    soldCount: s.ids.length,
    grossAmount: s.amount,
    platformFeeAmount: 0,
    instructorAmount: s.amount,
    earningIds: s.ids,
  })),
});

const ALEX = group("alex", "Alex Lee", [
  { key: "bls", label: "BLS Provider", amount: 100, ids: ["e1", "e2"] },
  { key: "acls", label: "ACLS", amount: 50, ids: ["e3"] },
]);
const BLAIR = group("blair", "Blair Cho", [{ key: "pals", label: "PALS", amount: 80, ids: ["e4"] }]);

const UPCOMING: UpcomingPayoutsData = {
  payableNow: [ALEX, BLAIR],
  blocked: [],
  inFlight: [],
  payableTotals: {
    grossCollected: 230,
    platformCut: 0,
    instructorTotal: 230,
    inboundPayPalFees: 0,
    depositedAmount: 230,
    feeTrackedCount: 4,
    feeUntrackedCount: 0,
    estimatedPayoutFees: 0.5,
    estimatedNet: 0,
    earningCount: 4,
  },
  payoutFeeModel: { kind: "flat", perItem: 0.25, sampleItems: 7 },
  blockedTotal: 0,
  inFlightTotal: 0,
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ success: true, paypalBatchId: "PP-1", requestedCount: 3, reservedCount: 3 }), {
      status: 200,
    })
  );
});

/** The JSON body the component sent to /api/payouts/create. */
function sentIds(): string[] {
  const init = fetchMock.mock.calls[0][1] as { body: string };
  return (JSON.parse(init.body) as { earningIds: string[] }).earningIds;
}

describe("PayoutSendSection", () => {
  test("nothing is selected by default and Send selected is disabled", () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    expect(screen.getByRole("button", { name: /send selected/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /pay all/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Pay all disappears as soon as any individual choice is ticked", () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay Blair Cho" }));
    expect(screen.queryByRole("button", { name: /pay all/i })).not.toBeInTheDocument();
  });

  test("Pay all comes back when the selection is cleared", () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay Blair Cho" }));
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(screen.getByRole("button", { name: /pay all/i })).toBeInTheDocument();
  });

  test("Pay all stays hidden even when the individual ticks happen to cover everything", () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select every instructor" }));
    expect(screen.queryByRole("button", { name: /pay all/i })).not.toBeInTheDocument();
  });

  test("ticking an instructor selects everything they are owed and shows the total", () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay Alex Lee" }));

    // The details live in the button itself, not in text above it.
    expect(
      screen.getByRole("button", { name: "Send $150.00 to 1 instructor (2 classes)" })
    ).toBeEnabled();
    expect(screen.queryByText(/selected for/i)).not.toBeInTheDocument();
  });

  test("sends only the ticked instructor, and only after confirmation", async () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay Alex Lee" }));
    fireEvent.click(screen.getByRole("button", { name: /^send \$/i }));

    // Clicking Send selected only asks; nothing has gone to the server yet.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/through PayPal\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /confirm and send/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock.mock.calls[0][0]).toBe("/api/payouts/create");
    expect(sentIds().sort()).toEqual(["e1", "e2", "e3"]);
    expect(refreshMock).toHaveBeenCalled();
  });

  test("an individual class can be paid without the instructor's other classes", async () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    // Expand Alex to reveal the class rows.
    fireEvent.click(screen.getByRole("button", { name: /Alex Lee/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay ACLS for Alex Lee" }));

    expect(
      screen.getByRole("button", { name: "Send $50.00 to 1 instructor (1 class)" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^send \$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm and send/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentIds()).toEqual(["e3"]);
  });

  test("Pay all selects everything payable and still asks for confirmation", async () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("button", { name: /pay all/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm and send/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentIds().sort()).toEqual(["e1", "e2", "e3", "e4"]);
  });

  test("the select-all header ticks every instructor", () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select every instructor" }));
    expect(
      screen.getByRole("button", { name: "Send $230.00 to 2 instructors (3 classes)" })
    ).toBeInTheDocument();
  });

  test("cancelling the confirmation sends nothing and keeps the selection", () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay Blair Cho" }));
    fireEvent.click(screen.getByRole("button", { name: /^send \$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Send $80.00 to 1 instructor (1 class)" })
    ).toBeInTheDocument();
  });

  test("changing the selection while confirming drops the confirmation", () => {
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay Blair Cho" }));
    fireEvent.click(screen.getByRole("button", { name: /^send \$/i }));
    // Pay all re-opens the confirmation; ticking again must not leave a stale one.
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay Alex Lee" }));
    expect(screen.queryByText(/through PayPal\?/i)).not.toBeInTheDocument();
  });

  test("shows the server's reason when a send fails and keeps the selection", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "No pending earnings are ready to pay." }), { status: 400 })
    );
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay Blair Cho" }));
    fireEvent.click(screen.getByRole("button", { name: /^send \$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm and send/i }));

    expect(await screen.findByText("No pending earnings are ready to pay.")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Send $80.00 to 1 instructor (1 class)" })
    ).toBeInTheDocument();
  });

  test("says so when some selected payments were skipped", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, paypalBatchId: "PP-9", requestedCount: 3, reservedCount: 2 }), {
        status: 200,
      })
    );
    render(<PayoutSendSection upcoming={UPCOMING} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pay Alex Lee" }));
    fireEvent.click(screen.getByRole("button", { name: /^send \$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm and send/i }));

    expect(await screen.findByText(/1 selected payment was skipped/i)).toBeInTheDocument();
  });

  test("shows no send bar when nothing is payable", () => {
    render(<PayoutSendSection upcoming={{ ...UPCOMING, payableNow: [] }} />);
    expect(screen.queryByRole("button", { name: /send selected/i })).not.toBeInTheDocument();
  });
});
