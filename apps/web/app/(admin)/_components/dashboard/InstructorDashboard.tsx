/**
 * InstructorDashboard — dashboard view for the instructor role.
 * Shows: today's classes, sessions needing grades, pending invoices, and daily rollcall code.
 * Used by: app/(admin)/page.tsx
 */

import Link from "next/link";
import RollcallCodeWidget from "./RollcallCodeWidget";
import PendingGradesWidget from "./PendingGradesWidget";
import PendingInvoicesWidget from "./PendingInvoicesWidget";
import OpenOpportunitiesWidget from "./OpenOpportunitiesWidget";
import PromoCodesWidget from "./PromoCodesWidget";
import type { PendingGradeSession } from "./PendingGradesWidget";
import type { PendingInvoice } from "./PendingInvoicesWidget";
import type { OpenOpportunity } from "./OpenOpportunitiesWidget";
import type { ActivePromoCode } from "./PromoCodesWidget";

export type { PendingGradeSession, PendingInvoice, OpenOpportunity, ActivePromoCode };

/** A single class session happening today for this instructor. */
export interface TodaySession {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  class_types: { name: string } | null;
  locations: { name: string } | null;
}

export interface InstructorDashboardProps {
  firstName: string;
  todaySessions: TodaySession[];
  pendingGrades: PendingGradeSession[];
  pendingInvoices: PendingInvoice[];
  openOpportunities: OpenOpportunity[];
  dailyAccessCode: string | null;
  dailyAccessCodeGeneratedAt: string | null;
  activePromoCodes: ActivePromoCode[];
}

/** Status badge color map for session status values. */
const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

/**
 * Formats a timestamptz string as a short time range, e.g. "9:00 AM – 11:00 AM".
 * @param startsAt - ISO start timestamp
 * @param endsAt - ISO end timestamp
 */
function formatTimeRange(startsAt: string, endsAt: string): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}

/** Role-specific dashboard for instructors. All data is pre-fetched and passed as props. */
export default function InstructorDashboard({
  firstName,
  todaySessions,
  pendingGrades,
  pendingInvoices,
  openOpportunities,
  dailyAccessCode,
  dailyAccessCodeGeneratedAt,
  activePromoCodes,
}: InstructorDashboardProps) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">
        Good morning, {firstName}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Widget: Daily Rollcall Code ── */}
        <RollcallCodeWidget initialCode={dailyAccessCode} initialGeneratedAt={dailyAccessCodeGeneratedAt} />

        {/* ── Widget: Open Opportunities ── */}
        <OpenOpportunitiesWidget opportunities={openOpportunities} />

        {/* ── Widget: Today's Classes ── */}
        {todaySessions.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Today&apos;s Class Sessions
            </h2>
            <ul className="space-y-3">
              {todaySessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={`/admin/sessions/${session.id}`}
                    className="flex items-start justify-between hover:bg-gray-50 -mx-2 px-2 py-2 rounded-md transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {session.class_types?.name ?? "Unknown Class"}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatTimeRange(session.starts_at, session.ends_at)}
                        {session.locations?.name
                          ? ` · ${session.locations.name}`
                          : ""}
                      </p>
                    </div>
                    <span
                      className={[
                        "text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ml-3",
                        STATUS_COLORS[session.status] ?? "bg-gray-100 text-gray-600",
                      ].join(" ")}
                    >
                      {session.status.replace("_", " ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Widget: Active Promo Codes ── */}
        <PromoCodesWidget codes={activePromoCodes} />

        {/* ── Widget: Pending Grades ── */}
        <PendingGradesWidget sessions={pendingGrades} />

        {/* ── Widget: Pending Invoices ── */}
        <PendingInvoicesWidget invoices={pendingInvoices} />
      </div>
    </div>
  );
}
