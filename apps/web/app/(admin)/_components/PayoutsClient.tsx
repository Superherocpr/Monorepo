"use client";

/**
 * PayoutsClient — interactive admin payout dashboard.
 * Used by: app/(admin)/admin/payouts/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RefreshCw, Send, AlertTriangle } from "lucide-react";

/** Grouped pending earning totals for one instructor. */
export interface PendingPayoutGroup {
  instructorId: string;
  instructorName: string;
  instructorEmail: string;
  paypalPayoutEmail: string | null;
  pendingGrossAmount: number;
  pendingPlatformFeeAmount: number;
  pendingInstructorAmount: number;
  earningCount: number;
}

/** Recent payout batch row for admin review. */
export interface PayoutBatchSummary {
  id: string;
  status: string;
  senderBatchId: string;
  paypalPayoutBatchId: string | null;
  totalAmount: number;
  itemCount: number;
  errorMessage: string | null;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
}

/** Data passed from the server payout page. */
export interface PayoutsPageData {
  pendingGroups: PendingPayoutGroup[];
  recentBatches: PayoutBatchSummary[];
  pendingTotal: number;
  payableTotal: number;
}

/** Response returned by payout API routes. */
interface PayoutApiResponse {
  success: boolean;
  error?: string;
  batchId?: string;
  paypalBatchId?: string;
  syncedItems?: number;
}

interface PayoutsClientProps {
  data: PayoutsPageData;
}

/** Formats a number as USD currency. */
function fmtCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/** Formats a date/time value for compact admin display. */
function fmtDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Returns Tailwind classes for a payout batch status badge. */
function statusClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-700";
    case "failed":
      return "bg-red-100 text-red-700";
    case "submitted":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

/** Type guard for payout API responses. */
function isPayoutApiResponse(value: unknown): value is PayoutApiResponse {
  return typeof value === "object" && value !== null && "success" in value;
}

/**
 * Admin payout dashboard with send/sync actions.
 * Manages button loading state and refreshes server data after mutations.
 */
export default function PayoutsClient({ data }: PayoutsClientProps) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [releasingBatchId, setReleasingBatchId] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  /** Sends all eligible pending earnings as one PayPal payout batch. */
  async function handleSendPayouts() {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/payouts/create", { method: "POST" });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok || !isPayoutApiResponse(body) || !body.success) {
        setMessage({
          type: "error",
          text:
            isPayoutApiResponse(body) && body.error
              ? body.error
              : "Failed to send payouts.",
        });
        return;
      }

      setMessage({
        type: "success",
        text: `Payout batch sent to PayPal${body.paypalBatchId ? ` (${body.paypalBatchId})` : ""}.`,
      });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: "Something went wrong sending payouts." });
    } finally {
      setSending(false);
    }
  }

  /** Syncs PayPal status for submitted payout batches. */
  async function handleSyncPayouts() {
    setSyncing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/payouts/sync", { method: "POST" });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok || !isPayoutApiResponse(body) || !body.success) {
        setMessage({
          type: "error",
          text:
            isPayoutApiResponse(body) && body.error
              ? body.error
              : "Failed to sync payout status.",
        });
        return;
      }

      setMessage({
        type: "success",
        text: `Synced ${body.syncedItems ?? 0} payout item${body.syncedItems === 1 ? "" : "s"}.`,
      });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: "Something went wrong syncing payouts." });
    } finally {
      setSyncing(false);
    }
  }

  /** Releases a failed unsubmitted batch after the admin confirms PayPal review. */
  async function handleReleaseBatch(batchId: string) {
    const confirmed = window.confirm(
      "Release this failed batch only after confirming in PayPal that no payout was created."
    );
    if (!confirmed) return;

    setReleasingBatchId(batchId);
    setMessage(null);

    try {
      const response = await fetch("/api/payouts/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok || !isPayoutApiResponse(body) || !body.success) {
        setMessage({
          type: "error",
          text:
            isPayoutApiResponse(body) && body.error
              ? body.error
              : "Failed to release payout batch.",
        });
        return;
      }

      setMessage({
        type: "success",
        text: "Payout batch released back to pending earnings.",
      });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: "Something went wrong releasing the batch." });
    } finally {
      setReleasingBatchId(null);
    }
  }

  const payableGroups = data.pendingGroups.filter((group) => group.paypalPayoutEmail);
  const blockedGroups = data.pendingGroups.filter((group) => !group.paypalPayoutEmail);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Instructor Payouts</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Review pending instructor earnings and send approved amounts through PayPal Payouts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSyncPayouts}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {syncing ? "Syncing..." : "Sync Status"}
          </button>
          <button
            type="button"
            onClick={handleSendPayouts}
            disabled={sending || payableGroups.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {sending ? "Sending..." : "Send Pending Payouts"}
          </button>
        </div>
      </div>

      {message && (
        <div
          role="status"
          className={`mb-6 flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${
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
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm font-medium text-gray-500">Pending instructor earnings</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{fmtCurrency(data.pendingTotal)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm font-medium text-gray-500">Payable now</p>
          <p className="mt-2 text-2xl font-bold text-green-700">{fmtCurrency(data.payableTotal)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm font-medium text-gray-500">Blocked instructors</p>
          <p className="mt-2 text-2xl font-bold text-amber-700">{blockedGroups.length}</p>
        </div>
      </div>

      <section className="mb-10 rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Pending earnings</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-3">Instructor</th>
                <th className="px-5 py-3">PayPal email</th>
                <th className="px-5 py-3 text-right">Gross</th>
                <th className="px-5 py-3 text-right">SuperHeroCPR cut</th>
                <th className="px-5 py-3 text-right">Payout</th>
                <th className="px-5 py-3 text-right">Items</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.pendingGroups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-gray-500">
                    No pending instructor earnings.
                  </td>
                </tr>
              ) : (
                data.pendingGroups.map((group) => (
                  <tr key={group.instructorId}>
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900">{group.instructorName}</p>
                      <p className="text-xs text-gray-500">{group.instructorEmail}</p>
                    </td>
                    <td className="px-5 py-4">
                      {group.paypalPayoutEmail ? (
                        <span className="text-gray-700">{group.paypalPayoutEmail}</span>
                      ) : (
                        <span className="font-medium text-amber-700">Missing payout email</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right text-gray-700">
                      {fmtCurrency(group.pendingGrossAmount)}
                    </td>
                    <td className="px-5 py-4 text-right text-gray-700">
                      {fmtCurrency(group.pendingPlatformFeeAmount)}
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-gray-900">
                      {fmtCurrency(group.pendingInstructorAmount)}
                    </td>
                    <td className="px-5 py-4 text-right text-gray-700">{group.earningCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Recent payout batches</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">PayPal batch</th>
                <th className="px-5 py-3 text-right">Amount</th>
                <th className="px-5 py-3 text-right">Items</th>
                <th className="px-5 py-3">Error</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recentBatches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-gray-500">
                    No payout batches yet.
                  </td>
                </tr>
              ) : (
                data.recentBatches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="px-5 py-4 text-gray-700">{fmtDateTime(batch.createdAt)}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(batch.status)}`}>
                        {batch.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-700">
                      {batch.paypalPayoutBatchId ?? batch.senderBatchId}
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-gray-900">
                      {fmtCurrency(batch.totalAmount)}
                    </td>
                    <td className="px-5 py-4 text-right text-gray-700">{batch.itemCount}</td>
                    <td className="max-w-xs px-5 py-4 text-xs text-red-700">
                      {batch.errorMessage ?? ""}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {batch.status === "failed" && !batch.paypalPayoutBatchId ? (
                        <button
                          type="button"
                          onClick={() => handleReleaseBatch(batch.id)}
                          disabled={releasingBatchId === batch.id}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
                        >
                          {releasingBatchId === batch.id ? "Releasing..." : "Release"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
