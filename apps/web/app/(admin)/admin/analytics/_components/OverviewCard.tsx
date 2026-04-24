"use client";

/**
 * OverviewCard — a single metric card in the overview strip.
 * Shows a large value, label, and trend indicator vs previous period.
 * Used by: AnalyticsClient.tsx (overview section)
 */

import type { TrendCard } from "./analyticsData";

interface Props {
  label: string;
  card: TrendCard;
  /** Format value as USD currency. Default false. */
  currency?: boolean;
}

/**
 * Renders a metric card with trend indicator.
 * @param label - metric name shown below the value
 * @param card - current value and previous period value for trend calc
 * @param currency - if true, formats value with $ prefix
 */
export function OverviewCard({ label, card, currency = false }: Props) {
  const { value, previousValue } = card;

  // Trend calculation — avoid division by zero
  const hasPrev = previousValue > 0;
  const changePct = hasPrev
    ? Math.round(((value - previousValue) / previousValue) * 100)
    : null;
  const isUp = changePct !== null && changePct >= 0;

  const formattedValue = currency
    ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : value.toLocaleString("en-US");

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-5">
      <p className="text-3xl font-bold text-gray-900">{formattedValue}</p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
      {changePct !== null && (
        <p
          className={`text-xs mt-2 font-medium ${isUp ? "text-green-600" : "text-red-500"}`}
          aria-label={`${isUp ? "Up" : "Down"} ${Math.abs(changePct)} percent vs previous period`}
        >
          {/* Explicit text direction alongside color for accessibility */}
          {isUp ? "▲" : "▼"} {Math.abs(changePct)}% vs previous period
        </p>
      )}
      {changePct === null && (
        <p className="text-xs mt-2 text-gray-400">No prior period data</p>
      )}
    </div>
  );
}
