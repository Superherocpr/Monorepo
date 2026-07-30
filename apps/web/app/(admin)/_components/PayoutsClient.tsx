"use client";

/**
 * PayoutsClient — page shell for /admin/payouts.
 *
 * Owns the page heading and the "Send Pending Payouts" action, then delegates all
 * display to the two shared panels also used by Settings → Payouts. Sync, deny,
 * resend, and release actions live inside PayoutHistoryPanel.
 *
 * Used by: app/(admin)/admin/payouts/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Send } from "lucide-react";
import UpcomingPayoutsPanel from "@/app/(admin)/_components/UpcomingPayoutsPanel";
import PayoutHistoryPanel from "@/app/(admin)/_components/PayoutHistoryPanel";
import type { PayoutHistoryBatch, UpcomingPayoutsData } from "@/types/payouts";

interface PayoutsClientProps {
  upcoming: UpcomingPayoutsData;
  history: PayoutHistoryBatch[];
}

/** Response returned by POST /api/payouts/create. */
interface PayoutCreateResponse {
  success: boolean;
  error?: string;
  paypalBatchId?: string;
  totalAmount?: number;
  itemCount?: number;
}

/** Type guard for payout create responses. */
function isCreateResponse(value: unknown): value is PayoutCreateResponse {
  return typeof value === "object" && value !== null && "success" in value;
}

/**
 * Admin payout dashboard shell with the manual send action.
 * Refreshes server data after sending so the panels reflect the new state.
 */
export default function PayoutsClient({ upcoming, history }: PayoutsClientProps) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  /** Sends all eligible pending earnings as one PayPal payout batch. */
  async function handleSendPayouts() {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/payouts/create", { method: "POST" });
      const parsed: unknown = await response.json().catch(() => null);

      if (!response.ok || !isCreateResponse(parsed) || !parsed.success) {
        setMessage({
          type: "error",
          text:
            isCreateResponse(parsed) && parsed.error ? parsed.error : "Failed to send payouts.",
        });
        return;
      }

      setMessage({
        type: "success",
        text: `Payout batch sent to PayPal${parsed.paypalBatchId ? ` (${parsed.paypalBatchId})` : ""}. It stays "assumed complete" until PayPal confirms delivery.`,
      });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: "Something went wrong sending payouts." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Instructor Payouts
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
            Review what instructors are owed, send payouts through PayPal, and track what
            PayPal actually did with each batch.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSendPayouts}
          disabled={sending || upcoming.payableNow.length === 0}
          className="inline-flex items-center gap-2 self-start rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {sending ? "Sending…" : "Send Pending Payouts"}
        </button>
      </div>

      {message ? (
        <div
          role="status"
          className={`mb-6 flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
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

      <UpcomingPayoutsPanel data={upcoming} />
      <PayoutHistoryPanel batches={history} />
    </div>
  );
}
