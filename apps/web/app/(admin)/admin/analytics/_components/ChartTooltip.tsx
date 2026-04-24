"use client";

/**
 * ChartTooltip — custom Recharts tooltip styled to the admin design system.
 * White background, subtle border, clean typography. Used across all charts.
 * Used by: AnalyticsClient.tsx (all Recharts chart components)
 */

import type { TooltipProps } from "recharts";
import type { ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";

interface Props extends TooltipProps<ValueType, NameType> {
  /** Format values as currency (prepends $). Default false. */
  currency?: boolean;
}

/**
 * Renders a styled tooltip card for Recharts charts.
 * @param active - whether the tooltip is currently shown
 * @param payload - data points to display
 * @param label - the x-axis label (period / name)
 * @param currency - if true, formats values as USD
 */
export function ChartTooltip({ active, payload, label, currency = false }: Props) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 text-sm">
      {label && <p className="font-medium text-gray-900 mb-1">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="text-gray-600">
          <span className="font-medium" style={{ color: entry.color }}>
            {entry.name}:
          </span>{" "}
          {currency
            ? `$${Number(entry.value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : String(entry.value ?? 0)}
        </p>
      ))}
    </div>
  );
}
