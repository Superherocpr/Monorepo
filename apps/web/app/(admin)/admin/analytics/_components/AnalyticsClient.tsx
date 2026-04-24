"use client";

/**
 * AnalyticsClient — root client component for /admin/analytics.
 * Owns the date range filter state and re-fetches all sections when the range changes.
 * Each section loads/updates independently — the page never goes entirely blank.
 * Used by: app/(admin)/admin/analytics/page.tsx
 */

import { useState, useCallback, useTransition } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  Users,
  BarChart2,
  ShoppingBag,
  FileText,
  AlertTriangle,
  Download,
  CheckCircle2,
  ChevronDown,
  LayoutDashboard,
} from "lucide-react";
import type { AnalyticsData } from "./analyticsData";
import { OverviewCard } from "./OverviewCard";
import { ChartTooltip } from "./ChartTooltip";

// ── Colour palette ────────────────────────────────────────────────────────────
const RED = "#dc2626";
const GRAY = "#6b7280";
const AMBER = "#d97706";
const GREEN = "#16a34a";
const BLUE = "#2563eb";
const PIE_COLORS = [RED, GREEN, GRAY];

// ── Preset ranges ─────────────────────────────────────────────────────────────
type PresetKey = "30d" | "90d" | "thisYear" | "lastYear" | "allTime";

interface Preset {
  label: string;
  key: PresetKey;
}

const PRESETS: Preset[] = [
  { label: "Last 30 days", key: "30d" },
  { label: "Last 90 days", key: "90d" },
  { label: "This year", key: "thisYear" },
  { label: "Last year", key: "lastYear" },
  { label: "All time", key: "allTime" },
];

/**
 * Computes ISO start/end strings for a named preset relative to today.
 * @param key - preset identifier
 */
function presetToDates(key: PresetKey): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  switch (key) {
    case "30d":
      return {
        start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        end,
      };
    case "90d":
      return {
        start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        end,
      };
    case "thisYear": {
      const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();
      return { start: startOfYear, end };
    }
    case "lastYear": {
      const lastYearStart = new Date(now.getFullYear() - 1, 0, 1).toISOString();
      const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59).toISOString();
      return { start: lastYearStart, end: lastYearEnd };
    }
    case "allTime":
      return { start: "2000-01-01T00:00:00.000Z", end };
  }
}

// ── Empty-state helper ────────────────────────────────────────────────────────

/** Renders a subtle "No data for this period" placeholder inside a section. */
function EmptyState({ icon: Icon }: { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-gray-400">
      <Icon className="w-8 h-8 mb-2" />
      <p className="text-sm">No data for this period.</p>
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

/** Renders a collapsible section heading button with a Lucide icon and chevron indicator. */
function SectionHeading({
  icon: Icon,
  label,
  isCollapsed,
  onToggle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 w-full text-left mb-4 group"
      aria-expanded={!isCollapsed}
    >
      <Icon className="w-5 h-5 text-red-600" />
      <h2 className="text-lg font-semibold text-gray-900 flex-1">{label}</h2>
      <ChevronDown
        className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
          isCollapsed ? "-rotate-90" : ""
        }`}
        aria-hidden="true"
      />
    </button>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

/** Wraps chart/stat content in the standard admin card. */
function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-gray-200 rounded-lg shadow-sm p-5 ${className}`}>
      {children}
    </div>
  );
}

// ── Section skeleton (loading state) ─────────────────────────────────────────

/** Animated loading placeholder for a chart card. */
function ChartSkeleton() {
  return (
    <div className="animate-pulse h-[280px] bg-gray-100 rounded-lg" aria-hidden="true" />
  );
}

// ── CSV export helper ────────────────────────────────────────────────────────

/**
 * Generates and downloads a CSV with key metrics for the current date range.
 * @param data - the current AnalyticsData payload
 * @param rangeStart - ISO range start for the filename
 * @param rangeEnd - ISO range end for the filename
 */
function exportCSV(data: AnalyticsData, rangeStart: string, rangeEnd: string) {
  const rows: string[][] = [
    ["Superhero CPR Analytics Export"],
    [`Range: ${rangeStart.slice(0, 10)} to ${rangeEnd.slice(0, 10)}`],
    [],
    ["Revenue Summary"],
    ["Metric", "Value"],
    ["Total Revenue", `$${data.totalRevenue.value.toFixed(2)}`],
    ["Online Booking Revenue", `$${data.onlineRevenue.value.toFixed(2)}`],
    ["Invoice Revenue", `$${data.invoiceRevenue.value.toFixed(2)}`],
    [],
    ["Class Stats"],
    ["Students Trained", String(data.studentsTrained.value)],
    ["Sessions Cancelled", String(data.cancellationRate.cancelled)],
    ["Total Sessions Scheduled", String(data.cancellationRate.total)],
    [],
    ["Invoice Stats"],
    ["Invoices Sent", String(data.invoiceStats.sent)],
    ["Invoices Paid", String(data.invoiceStats.paid)],
    ["Invoices Cancelled", String(data.invoiceStats.cancelled)],
    ["Avg Days to Payment", String(data.invoiceStats.avgDaysToPayment)],
    [],
    ["Merch Stats"],
    ...data.merchProducts.map((p) => [p.name, `${p.unitsSold} units`, `$${p.revenue.toFixed(2)}`]),
  ];

  const csv = rows
    .map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `analytics-${rangeStart.slice(0, 10)}-to-${rangeEnd.slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  initialData: AnalyticsData;
  initialStart: string;
  initialEnd: string;
}

/**
 * Root analytics client — manages filter state, triggers re-fetches,
 * and renders all sections with appropriate loading states.
 * @param initialData - data fetched server-side for the default range
 * @param initialStart - default range start ISO string
 * @param initialEnd - default range end ISO string
 */
export function AnalyticsClient({ initialData, initialStart, initialEnd }: Props) {
  const [data, setData] = useState<AnalyticsData>(initialData);
  const [rangeStart, setRangeStart] = useState(initialStart);
  const [rangeEnd, setRangeEnd] = useState(initialEnd);
  const [activePreset, setActivePreset] = useState<PresetKey | null>("90d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Tracks which sections are collapsed — all collapsed by default
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    overview: true,
    revenue: true,
    classes: true,
    students: true,
    invoices: true,
    merch: true,
  });

  /** Toggles the collapsed state for a named section. */
  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  /**
   * Fetches fresh analytics data for a given range and updates state.
   * @param start - range start ISO string
   * @param end - range end ISO string
   */
  const loadRange = useCallback((start: string, end: string) => {
    setRangeStart(start);
    setRangeEnd(end);
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/analytics?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
      if (!res.ok) {
        setError("Failed to load analytics data.");
        return;
      }
      const freshData = (await res.json()) as AnalyticsData;
      setData(freshData);
    });
  }, []);

  /** Handles a preset pill click. */
  function handlePreset(key: PresetKey) {
    setActivePreset(key);
    const { start, end } = presetToDates(key);
    loadRange(start, end);
  }

  /** Handles the custom range Apply click. */
  function handleCustomApply() {
    if (!customFrom || !customTo) return;
    setActivePreset(null);
    loadRange(
      new Date(customFrom).toISOString(),
      new Date(customTo + "T23:59:59.999Z").toISOString()
    );
  }

  // ── Derived display values ──────────────────────────────────────────────
  const cancellationPct =
    data.cancellationRate.total > 0
      ? Math.round((data.cancellationRate.cancelled / data.cancellationRate.total) * 100)
      : 0;

  const invoiceConversionPct =
    data.invoiceStats.sent > 0
      ? Math.round((data.invoiceStats.paid / data.invoiceStats.sent) * 100)
      : 0;

  const certRenewalPct =
    data.certRenewalRate && data.certRenewalRate.total > 0
      ? Math.round((data.certRenewalRate.renewed / data.certRenewalRate.total) * 100)
      : null;

  const invoicePieData = [
    { name: "Paid", value: data.invoiceStats.paid },
    { name: "Sent (unpaid)", value: Math.max(0, data.invoiceStats.sent - data.invoiceStats.paid - data.invoiceStats.cancelled) },
    { name: "Cancelled", value: data.invoiceStats.cancelled },
  ].filter((d) => d.value > 0);

  // ── Capacity colour helper ──────────────────────────────────────────────
  function capacityColor(pct: number) {
    if (pct >= 80) return GREEN;
    if (pct >= 50) return AMBER;
    return RED;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Business performance overview</p>
        </div>
        <button
          onClick={() => exportCSV(data, rangeStart, rangeEnd)}
          className="inline-flex items-center gap-2 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg shadow-sm"
          aria-label="Export current analytics as CSV"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* ── Date range filter — sticky ─────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200 pb-4 mb-8 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-4">
        <div className="flex flex-wrap gap-2 items-center">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => handlePreset(preset.key)}
              className={
                activePreset === preset.key
                  ? "bg-red-600 text-white text-sm font-medium px-3 py-1.5 rounded-full"
                  : "bg-white border border-gray-200 text-gray-600 text-sm px-3 py-1.5 rounded-full hover:border-gray-300"
              }
              aria-pressed={activePreset === preset.key}
            >
              {preset.label}
            </button>
          ))}

          {/* Custom range */}
          <div className="flex items-center gap-2 ml-2">
            <label htmlFor="custom-from" className="text-sm text-gray-600 sr-only">
              From date
            </label>
            <input
              id="custom-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              aria-label="Custom range from date"
            />
            <span className="text-gray-400 text-sm">to</span>
            <label htmlFor="custom-to" className="text-sm text-gray-600 sr-only">
              To date
            </label>
            <input
              id="custom-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              aria-label="Custom range to date"
            />
            <button
              onClick={handleCustomApply}
              disabled={!customFrom || !customTo}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
            >
              Apply
            </button>
          </div>
        </div>

        {/* Loading indicator */}
        {isPending && (
          <p className="text-xs text-gray-400 mt-2 animate-pulse">Updating…</p>
        )}
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>

      {/* ── Section 1: Overview strip ─────────────────────────────────── */}
      <div className="mb-10">
        <SectionHeading
          icon={LayoutDashboard}
          label="Overview"
          isCollapsed={!!collapsed["overview"]}
          onToggle={() => toggleSection("overview")}
        />
        <div className={collapsed["overview"] ? "hidden" : ""}>
          <div
            className="grid grid-cols-2 lg:grid-cols-4 gap-4"
            aria-label="Overview metrics"
          >
            {isPending ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse bg-gray-100 rounded-lg h-24" />
              ))
            ) : (
              <>
                <OverviewCard label="Total Revenue" card={data.totalRevenue} currency />
                <OverviewCard label="Online Booking Revenue" card={data.onlineRevenue} currency />
                <OverviewCard label="Invoice Revenue" card={data.invoiceRevenue} currency />
                <OverviewCard label="Students Trained" card={data.studentsTrained} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 2: Revenue ───────────────────────────────────────── */}
      <div className="mb-10">
        <SectionHeading
          icon={TrendingUp}
          label="Revenue"
          isCollapsed={!!collapsed["revenue"]}
          onToggle={() => toggleSection("revenue")}
        />
        <div className={collapsed["revenue"] ? "hidden" : ""}>

        {/* Revenue over time — full width */}
        <Card className="mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue Over Time</h3>
          {isPending ? (
            <ChartSkeleton />
          ) : data.revenueOverTime.length === 0 ? (
            <EmptyState icon={TrendingUp} />
          ) : (
            <ResponsiveContainer width="100%" height={280} aria-label="Revenue over time line chart">
              <LineChart data={data.revenueOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: GRAY }} />
                <YAxis
                  tick={{ fontSize: 11, fill: GRAY }}
                  tickFormatter={(v: number) => `$${v.toLocaleString()}`}
                />
                <Tooltip content={<ChartTooltip currency />} />
                <Legend />
                <Line type="monotone" dataKey="online" name="Online" stroke={RED} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="invoice" name="Invoice" stroke={BLUE} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Two-column: by class type / by instructor */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Class Type</h3>
            {isPending ? (
              <ChartSkeleton />
            ) : data.revenueByClassType.length === 0 ? (
              <EmptyState icon={BarChart2} />
            ) : (
              <ResponsiveContainer width="100%" height={280} aria-label="Revenue by class type bar chart">
                <BarChart data={data.revenueByClassType} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: GRAY }} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: GRAY }} width={100} />
                  <Tooltip content={<ChartTooltip currency />} />
                  <Bar dataKey="revenue" name="Revenue" fill={RED} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10, formatter: (v: unknown) => `$${Number(v).toLocaleString()}` }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Invoice Revenue by Instructor</h3>
            {isPending ? (
              <ChartSkeleton />
            ) : data.revenueByInstructor.length === 0 ? (
              <EmptyState icon={BarChart2} />
            ) : (
              <ResponsiveContainer width="100%" height={280} aria-label="Invoice revenue by instructor bar chart">
                <BarChart data={data.revenueByInstructor} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: GRAY }} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: GRAY }} width={120} />
                  <Tooltip content={<ChartTooltip currency />} />
                  <Bar dataKey="revenue" name="Revenue" fill={BLUE} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10, formatter: (v: unknown) => `$${Number(v).toLocaleString()}` }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
        </div>
      </div>

      {/* ── Section 3: Classes ───────────────────────────────────────── */}
      <div className="mb-10">
        <SectionHeading
          icon={BarChart2}
          label="Classes"
          isCollapsed={!!collapsed["classes"]}
          onToggle={() => toggleSection("classes")}
        />
        <div className={collapsed["classes"] ? "hidden" : ""}>

        {/* Classes per month — full width */}
        <Card className="mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Completed Sessions per Month</h3>
          {isPending ? (
            <ChartSkeleton />
          ) : data.sessionsPerMonth.length === 0 ? (
            <EmptyState icon={BarChart2} />
          ) : (
            <ResponsiveContainer width="100%" height={280} aria-label="Completed sessions per month bar chart">
              <BarChart data={data.sessionsPerMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: GRAY }} />
                <YAxis tick={{ fontSize: 11, fill: GRAY }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Sessions" fill={RED} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Two-column: capacity utilisation / cancellation rate + active instructors */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Avg Capacity Utilisation</h3>
            {isPending ? (
              <ChartSkeleton />
            ) : data.capacityUtilisation.length === 0 ? (
              <EmptyState icon={BarChart2} />
            ) : (
              <ResponsiveContainer width="100%" height={280} aria-label="Average capacity utilisation by class type">
                <BarChart data={data.capacityUtilisation} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: GRAY }} tickFormatter={(v: number) => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: GRAY }} width={100} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="avgPct" name="Avg capacity %" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10, formatter: (v: unknown) => `${v}%` }}>
                    {data.capacityUtilisation.map((entry, i) => (
                      <Cell key={i} fill={capacityColor(entry.avgPct)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <div className="flex flex-col gap-4">
            {/* Cancellation rate */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Cancellation Rate</h3>
              {isPending ? (
                <div className="animate-pulse h-16 bg-gray-100 rounded" />
              ) : (
                <>
                  <p className="text-3xl font-bold text-gray-900">{cancellationPct}%</p>
                  <p className="text-sm text-gray-500 mt-1">of sessions cancelled</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {data.cancellationRate.cancelled} cancelled out of{" "}
                    {data.cancellationRate.total} scheduled
                  </p>
                </>
              )}
            </Card>

            {/* Most active instructors */}
            <Card>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Most Active Instructors</h3>
              {isPending ? (
                <div className="animate-pulse space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-6 bg-gray-100 rounded" />
                  ))}
                </div>
              ) : data.activeInstructors.length === 0 ? (
                <EmptyState icon={Users} />
              ) : (
                <ol className="space-y-2">
                  {data.activeInstructors.slice(0, 5).map((inst, i) => (
                    <li key={i} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">
                        <span className="text-gray-400 mr-2">{i + 1}.</span>
                        {inst.name}
                      </span>
                      <span className="text-gray-500 text-xs">
                        {inst.completedSessions} sessions · {inst.studentsTotal} students
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </div>
        </div>
      </div>

      {/* ── Section 4: Students ──────────────────────────────────────── */}
      <div className="mb-10">
        <SectionHeading
          icon={Users}
          label="Students"
          isCollapsed={!!collapsed["students"]}
          onToggle={() => toggleSection("students")}
        />
        <div className={collapsed["students"] ? "hidden" : ""}>

        {/* New vs returning / cert renewal */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">New vs Returning Students</h3>
            {isPending ? (
              <div className="animate-pulse h-20 bg-gray-100 rounded" />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-3xl font-bold text-gray-900">{data.studentCounts.newCount}</p>
                  <p className="text-sm text-gray-500 mt-1">New customers</p>
                  <p className="text-xs text-gray-400 mt-0.5">First booking in range</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-gray-900">{data.studentCounts.returningCount}</p>
                  <p className="text-sm text-gray-500 mt-1">Returning customers</p>
                  <p className="text-xs text-gray-400 mt-0.5">Account created before range</p>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Certification Renewal Rate</h3>
            {isPending ? (
              <div className="animate-pulse h-20 bg-gray-100 rounded" />
            ) : certRenewalPct === null ? (
              <div className="text-sm text-gray-400">No certs expired in this period.</div>
            ) : (
              <>
                <p className="text-3xl font-bold text-gray-900">{certRenewalPct}%</p>
                <p className="text-sm text-gray-500 mt-1">of expiring certs renewed</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {data.certRenewalRate!.renewed} renewed out of{" "}
                  {data.certRenewalRate!.total} expiring (within 90 days)
                </p>
              </>
            )}
          </Card>
        </div>

        {/* Top employers — full width */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Top Employers</h3>
          {isPending ? (
            <div className="animate-pulse space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 rounded" />
              ))}
            </div>
          ) : data.topEmployers.length === 0 ? (
            <EmptyState icon={Users} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Top employers by student count">
                <thead>
                  <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-3 py-2">Employer</th>
                    <th className="text-right px-3 py-2">Students</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {data.topEmployers.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">{row.employer}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{row.studentCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </div>
      </div>

      {/* ── Section 5: Invoices ──────────────────────────────────────── */}
      <div className="mb-10">
        <SectionHeading
          icon={FileText}
          label="Invoices"
          isCollapsed={!!collapsed["invoices"]}
          onToggle={() => toggleSection("invoices")}
        />
        <div className={collapsed["invoices"] ? "hidden" : ""}>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Conversion rate */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Invoice Conversion Rate</h3>
            {isPending ? (
              <div className="animate-pulse h-20 bg-gray-100 rounded" />
            ) : (
              <>
                <p className="text-3xl font-bold text-gray-900">{invoiceConversionPct}%</p>
                <p className="text-sm text-gray-500 mt-1">paid</p>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                  <div className="bg-gray-50 rounded p-2">
                    <p className="font-bold text-gray-900">{data.invoiceStats.sent}</p>
                    <p className="text-gray-400">Sent</p>
                  </div>
                  <div className="bg-green-50 rounded p-2">
                    <p className="font-bold text-green-700">{data.invoiceStats.paid}</p>
                    <p className="text-green-600">Paid</p>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <p className="font-bold text-gray-500">{data.invoiceStats.cancelled}</p>
                    <p className="text-gray-400">Cancelled</p>
                  </div>
                </div>
              </>
            )}
          </Card>

          {/* Avg time to payment */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Avg Time to Payment</h3>
            {isPending ? (
              <div className="animate-pulse h-20 bg-gray-100 rounded" />
            ) : data.invoiceStats.paid === 0 ? (
              <div className="text-sm text-gray-400">No paid invoices in this period.</div>
            ) : (
              <>
                <p className="text-3xl font-bold text-gray-900">
                  {data.invoiceStats.avgDaysToPayment}
                </p>
                <p className="text-sm text-gray-500 mt-1">days on average</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  From invoice sent to payment received
                </p>
              </>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Instructors by invoice count */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Invoices Sent by Instructor</h3>
            {isPending ? (
              <ChartSkeleton />
            ) : data.instructorInvoiceCounts.length === 0 ? (
              <EmptyState icon={FileText} />
            ) : (
              <ResponsiveContainer width="100%" height={280} aria-label="Invoices sent per instructor bar chart">
                <BarChart data={data.instructorInvoiceCounts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: GRAY }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: GRAY }} width={120} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="Invoices" fill={RED} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10 }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Invoice status donut */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Invoice Status Breakdown</h3>
            {isPending ? (
              <ChartSkeleton />
            ) : invoicePieData.length === 0 ? (
              <EmptyState icon={FileText} />
            ) : (
              <ResponsiveContainer width="100%" height={280} aria-label="Invoice status breakdown donut chart">
                <PieChart>
                  <Pie
                    data={invoicePieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="value"
                    label={(props) => `${props.name ?? ""} ${Math.round((props.percent ?? 0) * 100)}%`}
                    labelLine={false}
                  >
                    {invoicePieData.map((_entry, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
        </div>
      </div>

      {/* ── Section 6: Merch ─────────────────────────────────────────── */}
      <div className="mb-10">
        <SectionHeading
          icon={ShoppingBag}
          label="Merch"
          isCollapsed={!!collapsed["merch"]}
          onToggle={() => toggleSection("merch")}
        />
        <div className={collapsed["merch"] ? "hidden" : ""}>

        {/* Merch revenue over time — full width */}
        <Card className="mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Merch Revenue Over Time</h3>
          {isPending ? (
            <ChartSkeleton />
          ) : data.merchRevenueOverTime.length === 0 ? (
            <EmptyState icon={ShoppingBag} />
          ) : (
            <ResponsiveContainer width="100%" height={280} aria-label="Merch revenue over time line chart">
              <LineChart data={data.merchRevenueOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: GRAY }} />
                <YAxis tick={{ fontSize: 11, fill: GRAY }} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                <Tooltip content={<ChartTooltip currency />} />
                <Line type="monotone" dataKey="revenue" name="Merch Revenue" stroke={RED} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Units sold / revenue by product */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Units Sold by Product</h3>
            {isPending ? (
              <ChartSkeleton />
            ) : data.merchProducts.length === 0 ? (
              <EmptyState icon={ShoppingBag} />
            ) : (
              <ResponsiveContainer width="100%" height={280} aria-label="Units sold per product bar chart">
                <BarChart
                  data={[...data.merchProducts].sort((a, b) => b.unitsSold - a.unitsSold)}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: GRAY }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: GRAY }} width={120} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="unitsSold" name="Units Sold" fill={RED} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10 }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Product</h3>
            {isPending ? (
              <ChartSkeleton />
            ) : data.merchProducts.length === 0 ? (
              <EmptyState icon={ShoppingBag} />
            ) : (
              <ResponsiveContainer width="100%" height={280} aria-label="Revenue per product bar chart">
                <BarChart data={data.merchProducts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: GRAY }} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: GRAY }} width={120} />
                  <Tooltip content={<ChartTooltip currency />} />
                  <Bar dataKey="revenue" name="Revenue" fill={AMBER} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10, formatter: (v: unknown) => `$${Number(v).toLocaleString()}` }} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        {/* Low stock alert */}
        {!isPending && data.lowStock.count > 0 && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4" role="alert">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                {data.lowStock.count} variant{data.lowStock.count === 1 ? "" : "s"} at or below low
                stock threshold.
              </p>
              <Link
                href="/admin/merch"
                className="text-sm text-amber-700 underline hover:text-amber-800 mt-0.5 inline-block"
              >
                Go to Merch Management →
              </Link>
            </div>
          </div>
        )}

        {!isPending && data.lowStock.count === 0 && (
          <div className="flex items-center gap-2 text-green-600 text-sm mt-2">
            <CheckCircle2 className="w-4 h-4" />
            All variants above low stock threshold.
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
