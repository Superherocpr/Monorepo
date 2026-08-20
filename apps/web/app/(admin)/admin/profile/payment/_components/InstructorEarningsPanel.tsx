"use client";

/**
 * InstructorEarningsPanel — shows an instructor's own earnings and payout history.
 * Displays summary stat tiles, an individual earnings breakdown table, and a
 * history of payout batches they were included in.
 * Used by: app/(admin)/admin/profile/payment/page.tsx
 */

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  FileText,
  GraduationCap,
  HelpCircle,
  X,
} from "lucide-react";
import { formatCurrency } from "@/lib/invoice-utils";
import type {
  InstructorEarningsData,
  InstructorOwnEarning,
  InstructorOwnPayoutItem,
  PayoutItemStatus,
} from "@/types/payouts";

interface InstructorEarningsPanelProps {
  data: InstructorEarningsData;
}

/** Formats an ISO timestamp as "Jan 15, 2025". */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Badge config for instructor_earnings.status values. */
const EARNING_STATUS: Record<
  string,
  { label: string; classes: string; icon: React.ReactNode }
> = {
  pending: {
    label: "Awaiting payout",
    classes: "bg-amber-100 text-amber-800",
    icon: <Clock className="h-3 w-3" aria-hidden="true" />,
  },
  payout_pending: {
    label: "In flight",
    classes: "bg-blue-100 text-blue-800",
    icon: <HelpCircle className="h-3 w-3" aria-hidden="true" />,
  },
  paid: {
    label: "Paid",
    classes: "bg-green-100 text-green-800",
    icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
  },
  cancelled: {
    label: "Cancelled",
    classes: "bg-gray-100 text-gray-600",
    icon: <X className="h-3 w-3" aria-hidden="true" />,
  },
  failed: {
    label: "Failed",
    classes: "bg-orange-100 text-orange-800",
    icon: <X className="h-3 w-3" aria-hidden="true" />,
  },
};

/** Badge config for instructor_payout_items.status values. */
const PAYOUT_ITEM_STATUS: Record<
  PayoutItemStatus,
  { label: string; classes: string }
> = {
  pending: { label: "Not sent", classes: "bg-gray-100 text-gray-700" },
  assumed_complete: { label: "Assumed sent", classes: "bg-blue-100 text-blue-800" },
  completed: { label: "Confirmed paid", classes: "bg-green-100 text-green-800" },
  denied: { label: "Returned by PayPal", classes: "bg-red-100 text-red-800" },
  failed: { label: "Failed", classes: "bg-orange-100 text-orange-800" },
  needs_review: { label: "Needs review", classes: "bg-amber-100 text-amber-900" },
  unclaimed: { label: "Unclaimed", classes: "bg-purple-100 text-purple-800" },
};

/**
 * One summary stat tile shown in the totals strip.
 * @param label - Metric name.
 * @param value - Formatted dollar value.
 * @param hint - Small helper text shown below the value.
 * @param tone - Color treatment for the value.
 */
function SummaryTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "positive" | "warning" | "info";
}): React.ReactElement {
  const valueClass =
    tone === "positive"
      ? "text-green-700"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "info"
          ? "text-blue-700"
          : "text-gray-900";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1.5 text-xl font-bold ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-gray-400">{hint}</p> : null}
    </div>
  );
}

/** Initial number of earnings rows shown before the "Show all" toggle. */
const INITIAL_ROWS = 10;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Expandable table of individual earning rows with month/year filter controls.
 * @param earnings - All earning rows for this instructor, newest first.
 */
function EarningsTable({ earnings }: { earnings: InstructorOwnEarning[] }): React.ReactElement {
  // Tracks WHICH filter the "show all" expansion applies to, rather than a bare
  // boolean plus an effect that resets it. Changing the filter changes the key,
  // so the list collapses back to the first page automatically — no effect, and
  // no cascading render. (React: you might not need an effect.)
  const [showAllForFilter, setShowAllForFilter] = useState<string | null>(null);
  const [filterYear, setFilterYear] = useState<number | null>(null);
  const [filterMonth, setFilterMonth] = useState<number | null>(null);

  // Years that actually have earnings, newest first.
  const availableYears = useMemo(() => {
    const years = new Set(earnings.map((e) => new Date(e.createdAt).getFullYear()));
    return Array.from(years).sort((a, b) => b - a);
  }, [earnings]);

  // Months (1-12) that have earnings within the selected year.
  const availableMonths = useMemo(() => {
    const months = new Set(
      earnings
        .filter(
          (e) => filterYear === null || new Date(e.createdAt).getFullYear() === filterYear
        )
        .map((e) => new Date(e.createdAt).getMonth() + 1)
    );
    return Array.from(months).sort((a, b) => a - b);
  }, [earnings, filterYear]);

  const filteredEarnings = useMemo(
    () =>
      earnings.filter((e) => {
        const d = new Date(e.createdAt);
        if (filterYear !== null && d.getFullYear() !== filterYear) return false;
        if (filterMonth !== null && d.getMonth() + 1 !== filterMonth) return false;
        return true;
      }),
    [earnings, filterYear, filterMonth]
  );

  const filterKey = `${filterYear ?? "all"}-${filterMonth ?? "all"}`;
  const showAll = showAllForFilter === filterKey;

  const isFiltered = filterYear !== null || filterMonth !== null;
  const visible = showAll ? filteredEarnings : filteredEarnings.slice(0, INITIAL_ROWS);

  if (earnings.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-gray-500">
        No earnings yet. They appear here once a class booking or invoice payment is completed.
      </p>
    );
  }

  return (
    <>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <select
          value={filterYear ?? ""}
          onChange={(e) => {
            setFilterYear(e.target.value ? Number(e.target.value) : null);
            setFilterMonth(null);
          }}
          className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          aria-label="Filter by year"
        >
          <option value="">All years</option>
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <select
          value={filterMonth ?? ""}
          onChange={(e) => setFilterMonth(e.target.value ? Number(e.target.value) : null)}
          disabled={availableMonths.length === 0}
          className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
          aria-label="Filter by month"
        >
          <option value="">All months</option>
          {availableMonths.map((m) => (
            <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>
          ))}
        </select>

        {isFiltered && (
          <button
            type="button"
            onClick={() => { setFilterYear(null); setFilterMonth(null); }}
            className="text-xs font-medium text-gray-500 hover:text-gray-800 underline underline-offset-2"
          >
            Clear
          </button>
        )}

        {isFiltered && (
          <span className="ml-auto text-xs text-gray-400">
            {filteredEarnings.length} of {earnings.length} earnings
          </span>
        )}
      </div>

      {filteredEarnings.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">
          No earnings for this period.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5 text-right">Your earnings</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((earning) => {
                  const cfg = EARNING_STATUS[earning.status] ?? EARNING_STATUS.pending;
                  return (
                    <tr key={earning.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {fmtDate(earning.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-start gap-2">
                          {earning.sourceType === "booking" ? (
                            <GraduationCap
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
                              aria-hidden="true"
                            />
                          ) : (
                            <FileText
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400"
                              aria-hidden="true"
                            />
                          )}
                          <span>
                            <span className="block font-medium text-gray-800">{earning.label}</span>
                            {earning.sessionDate || earning.detail ? (
                              <span className="block text-xs text-gray-500">
                                {earning.sessionDate ? fmtDate(earning.sessionDate) : earning.detail}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                        {formatCurrency(earning.instructorAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cfg.classes}`}
                        >
                          {cfg.icon}
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredEarnings.length > INITIAL_ROWS ? (
            <div className="border-t border-gray-100 px-4 py-3 text-center">
              <button
                type="button"
                onClick={() => setShowAllForFilter(showAll ? null : filterKey)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                {showAll ? (
                  <>
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    Show all {filteredEarnings.length} earnings
                  </>
                )}
              </button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

/**
 * Table of payout batches this instructor was included in.
 * Shows date, amount, status, and any denial or error info.
 * @param items - Payout items for this instructor, newest first.
 */
function PayoutItemsTable({ items }: { items: InstructorOwnPayoutItem[] }): React.ReactElement {
  if (items.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-gray-500">
        No payouts sent yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2.5">Date sent</th>
            <th className="px-4 py-2.5 text-right">Amount</th>
            <th className="px-4 py-2.5 text-right">PayPal fee</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => {
            const cfg = PAYOUT_ITEM_STATUS[item.status] ?? PAYOUT_ITEM_STATUS.pending;
            const note = item.denialReason ?? item.errorMessage ?? null;
            return (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="block text-sm text-gray-800">
                    {item.batchCreatedAt ? fmtDate(item.batchCreatedAt) : "—"}
                  </span>
                  {item.paypalPayoutBatchId ? (
                    <span className="mt-0.5 block font-mono text-[10px] text-gray-400">
                      {item.paypalPayoutBatchId}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900">
                  {formatCurrency(item.amount)}
                </td>
                <td className="px-4 py-3 text-right text-xs text-gray-500">
                  {item.paypalFeeAmount === null ? "—" : formatCurrency(item.paypalFeeAmount)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cfg.classes}`}
                  >
                    {cfg.label}
                  </span>
                  {item.status === "unclaimed" && item.unclaimedExpiresAt ? (
                    <span className="mt-0.5 block text-[11px] text-purple-700">
                      Returns to pool on {fmtDate(item.unclaimedExpiresAt)} if not claimed
                    </span>
                  ) : null}
                </td>
                <td className="max-w-[220px] px-4 py-3 text-xs text-gray-500">
                  {note ?? null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Root component for the instructor's own earnings view.
 * Renders a summary strip, an earnings breakdown table, and a payout history table.
 * @param data - Server-fetched earnings data scoped to this instructor.
 */
export default function InstructorEarningsPanel({
  data,
}: InstructorEarningsPanelProps): React.ReactElement {
  const { summary, earnings, payoutItems } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-gray-400" aria-hidden="true" />
        <h2 className="text-xl font-bold text-gray-900">My Earnings</h2>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile
          label="Total earned"
          value={formatCurrency(summary.totalEarned)}
          hint={`${summary.earningCount} payment${summary.earningCount === 1 ? "" : "s"} all time`}
        />
        <SummaryTile
          label="Paid out"
          value={formatCurrency(summary.paidAmount)}
          tone="positive"
          hint="Confirmed sent to your PayPal"
        />
        <SummaryTile
          label="Pending"
          value={formatCurrency(summary.pendingAmount)}
          tone="warning"
          hint="Waiting to be sent"
        />
        <SummaryTile
          label="In flight"
          value={formatCurrency(summary.inFlightAmount)}
          tone="info"
          hint="Sent to PayPal, awaiting confirmation"
        />
      </div>

      {/* Earnings breakdown */}
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">Earnings breakdown</h3>
          <p className="mt-1 text-xs text-gray-500">
            Each class booking and invoice that generated an earning for you, newest first.
          </p>
        </div>
        <EarningsTable earnings={earnings} />
      </section>

      {/* Payout history */}
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">Payout history</h3>
          <p className="mt-1 text-xs text-gray-500">
            Each time a payout was sent to your PayPal account.
            &ldquo;Assumed sent&rdquo; means PayPal accepted it but has not confirmed delivery yet
            — this resolves automatically within a few hours.
          </p>
        </div>
        <PayoutItemsTable items={payoutItems} />
      </section>
    </div>
  );
}
