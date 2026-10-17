"use client";

/**
 * PayoutSendSection: the Upcoming payouts table with checkboxes, plus the bar that
 * sends whatever is ticked. Nothing is paid until the admin confirms.
 *
 * Owns the selection, the confirm step, and the call to POST /api/payouts/create,
 * so /admin/payouts and Settings → Payouts send identically.
 * Used by: PayoutsClient and app/(admin)/admin/settings/_components/PayoutSettingsPanel.tsx
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Send } from "lucide-react";
import UpcomingPayoutsPanel from "@/app/(admin)/_components/UpcomingPayoutsPanel";
import { formatCurrency } from "@/lib/invoice-utils";
import {
  allEarningIds,
  pruneSelection,
  selectedEarningIds,
  summarizeSelection,
} from "@/lib/payout-selection";
import type { UpcomingPayoutsData } from "@/types/payouts";

/** Response returned by POST /api/payouts/create. */
interface PayoutCreateResponse {
  success: boolean;
  error?: string;
  paypalBatchId?: string;
  totalAmount?: number;
  itemCount?: number;
  requestedCount?: number | null;
  reservedCount?: number | null;
}

/** Type guard for payout create responses. */
function isCreateResponse(value: unknown): value is PayoutCreateResponse {
  return typeof value === "object" && value !== null && "success" in value;
}

interface PayoutSendSectionProps {
  upcoming: UpcomingPayoutsData;
}

/**
 * Upcoming payouts with per-instructor and per-class checkboxes and a send bar.
 * Refreshes server data after sending so the panels reflect the new state.
 */
export default function PayoutSendSection({ upcoming }: PayoutSendSectionProps) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  const groups = upcoming.payableNow;
  // Derived, not stored: after a send the refreshed data no longer contains the
  // paid earnings, and a stale id must never be resubmitted by the next click.
  const selected = useMemo(() => pruneSelection(chosen, groups), [chosen, groups]);
  const summary = useMemo(
    () => summarizeSelection(groups, selected, upcoming.payoutFeeModel),
    [groups, selected, upcoming.payoutFeeModel]
  );
  const everything = useMemo(
    () => summarizeSelection(groups, new Set(allEarningIds(groups)), upcoming.payoutFeeModel),
    [groups, upcoming.payoutFeeModel]
  );

  /** Changes the selection and drops any pending confirmation of the old one. */
  function changeSelection(next: Set<string>) {
    setChosen(next);
    setConfirming(false);
  }

  /** Selects everything payable and goes straight to the confirm step. */
  function payAll() {
    setChosen(new Set(allEarningIds(groups)));
    setMessage(null);
    setConfirming(true);
  }

  /**
   * Sends exactly the ticked earnings as one PayPal payout batch.
   * Side effects: POST /api/payouts/create (reserves earnings, calls PayPal),
   * then refreshes the page data.
   */
  async function handleSend() {
    const earningIds = selectedEarningIds(groups, selected);
    if (earningIds.length === 0) return;

    setSending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/payouts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ earningIds }),
      });
      const parsed: unknown = await response.json().catch(() => null);

      if (!response.ok || !isCreateResponse(parsed) || !parsed.success) {
        setMessage({
          type: "error",
          text:
            isCreateResponse(parsed) && parsed.error ? parsed.error : "Failed to send payouts.",
        });
        return;
      }

      const skipped =
        parsed.requestedCount != null && parsed.reservedCount != null
          ? parsed.requestedCount - parsed.reservedCount
          : 0;
      setMessage({
        type: "success",
        text:
          `Payout batch sent to PayPal${parsed.paypalBatchId ? ` (${parsed.paypalBatchId})` : ""}. ` +
          `It stays "assumed complete" until PayPal confirms delivery.` +
          (skipped > 0
            ? ` ${skipped} selected payment${skipped === 1 ? " was" : "s were"} skipped because ${skipped === 1 ? "it" : "they"} had already been sent or the instructor has no payout email.`
            : ""),
      });
      setChosen(new Set());
      router.refresh();
    } catch {
      setMessage({ type: "error", text: "Something went wrong sending payouts." });
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  const hasSelection = summary.earningCount > 0;
  const noun = (count: number, one: string, many: string) => (count === 1 ? one : many);

  return (
    <div>
      {message ? (
        <div
          role="status"
          className={`mb-4 flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{message.text}</span>
        </div>
      ) : null}

      <UpcomingPayoutsPanel
        data={upcoming}
        selection={{ selected, onChange: changeSelection }}
      />

      {groups.length > 0 ? (
        <div
          className="sticky bottom-3 z-10 mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-lg"
          aria-label="Send selected payouts"
        >
          {confirming && hasSelection ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-800">
                Send{" "}
                <strong>{formatCurrency(summary.instructorTotal)}</strong> to{" "}
                <strong>
                  {summary.instructorCount} {noun(summary.instructorCount, "instructor", "instructors")}
                </strong>{" "}
                through PayPal? Estimated PayPal fees: {formatCurrency(summary.estimatedFees)}.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={sending}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {sending ? "Sending…" : "Confirm and send"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {hasSelection ? null : (
                <p className="text-sm text-gray-500">
                  Tick instructors or classes above to choose who gets paid. Nothing is sent
                  until you confirm.
                </p>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                {hasSelection ? (
                  <button
                    type="button"
                    onClick={() => changeSelection(new Set())}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Clear
                  </button>
                ) : (
                  // Hidden as soon as anything is ticked, so nobody pays everyone by
                  // accident while they are choosing individual payouts.
                  <button
                    type="button"
                    onClick={payAll}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Pay all ({formatCurrency(everything.instructorTotal)})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={!hasSelection}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {hasSelection
                    ? `Send ${formatCurrency(summary.instructorTotal)} to ${summary.instructorCount} ${noun(summary.instructorCount, "instructor", "instructors")} (${summary.lineCount} ${noun(summary.lineCount, "class", "classes")})`
                    : "Send selected"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
