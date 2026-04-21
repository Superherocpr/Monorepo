/**
 * ManagerDashboard — dashboard view for the manager role.
 * Shows: pending approvals, today's all-instructor classes, recent bookings,
 * unanswered contact submissions, and low stock alerts.
 * Used by: app/(admin)/page.tsx and SuperAdminDashboard.tsx
 */

import Link from "next/link";

/** A class session happening today (all instructors). */
export interface ManagerTodaySession {
  id: string;
  starts_at: string;
  ends_at: string;
  max_capacity: number;
  enrolledCount: number;
  class_types: { name: string } | null;
  locations: { name: string } | null;
  instructor: { first_name: string; last_name: string } | null;
}

/** A recent booking with customer and session info. */
export interface RecentBooking {
  id: string;
  created_at: string;
  booking_source: string;
  customer: { first_name: string; last_name: string } | null;
  class_sessions: {
    starts_at: string;
    class_types: { name: string } | null;
  } | null;
}

/** A product variant that is at or below its product's low_stock_threshold. */
export interface LowStockVariant {
  id: string;
  size: string;
  stock_quantity: number;
  product_id: string;
  product_name: string;
  low_stock_threshold: number;
}

export interface ManagerDashboardProps {
  firstName: string;
  pendingApprovalsCount: number;
  todaySessions: ManagerTodaySession[];
  recentBookings: RecentBooking[];
  unansweredContactCount: number;
  lowStockVariants: LowStockVariant[];
  /** When true, suppresses the greeting h1 — used when ManagerDashboard is embedded in SuperAdminDashboard. */
  hideGreeting?: boolean;
}

/** Badge colors per booking source. */
const BOOKING_SOURCE_COLORS: Record<string, string> = {
  online: "bg-blue-100 text-blue-700",
  rollcall: "bg-green-100 text-green-700",
  invoice: "bg-purple-100 text-purple-700",
  manual: "bg-gray-100 text-gray-600",
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

/**
 * Formats a timestamptz string as a readable date, e.g. "Jun 12".
 * @param timestamp - ISO timestamp string
 */
function formatShortDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Role-specific dashboard for managers. All data is pre-fetched and passed as props. */
export default function ManagerDashboard({
  firstName,
  pendingApprovalsCount,
  todaySessions,
  recentBookings,
  unansweredContactCount,
  lowStockVariants,
  hideGreeting = false,
}: ManagerDashboardProps) {
  return (
    <div className="space-y-6">
      {!hideGreeting && (
        <h1 className="text-2xl font-bold text-gray-900">
          Good morning, {firstName}
        </h1>
      )}

      {/* ── Alert row: Pending Approvals + Contact ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pending approvals — always shown */}
        <Link
          href="/admin/sessions/approvals"
          className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-5 hover:border-gray-300 transition-colors"
        >
          <div>
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Pending Approvals
            </p>
            <p className="text-3xl font-bold text-gray-900 mt-1">
              {pendingApprovalsCount}
            </p>
          </div>
          {pendingApprovalsCount > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              Needs review
            </span>
          )}
        </Link>

        {/* Unanswered contact — hidden if zero */}
        {unansweredContactCount > 0 && (
          <Link
            href="/admin/contact"
            className="flex items-center justify-between bg-white border border-amber-300 rounded-lg p-5 hover:border-amber-400 transition-colors"
          >
            <div>
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Unanswered Contact
              </p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {unansweredContactCount}
              </p>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              Awaiting reply
            </span>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Widget: Today's Classes (all instructors) ── */}
        {todaySessions.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Today's Classes
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
                        {session.instructor
                          ? `${session.instructor.first_name} ${session.instructor.last_name}`
                          : "Unknown Instructor"}{" "}
                        · {formatTimeRange(session.starts_at, session.ends_at)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {session.locations?.name ?? "—"}
                      </p>
                    </div>
                    <span className="text-xs font-semibold shrink-0 ml-3 text-gray-600">
                      {session.enrolledCount}/{session.max_capacity}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Widget: Recent Bookings ── */}
        {recentBookings.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Recent Bookings
            </h2>
            <ul className="space-y-3">
              {recentBookings.map((booking) => (
                <li key={booking.id}>
                  <div className="flex items-start justify-between py-1">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {booking.customer
                          ? `${booking.customer.first_name} ${booking.customer.last_name}`
                          : "Unknown Customer"}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {booking.class_sessions?.class_types?.name ?? "—"} ·{" "}
                        {booking.class_sessions
                          ? formatShortDate(booking.class_sessions.starts_at)
                          : "—"}
                      </p>
                    </div>
                    <span
                      className={[
                        "text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ml-3",
                        BOOKING_SOURCE_COLORS[booking.booking_source] ??
                          "bg-gray-100 text-gray-600",
                      ].join(" ")}
                    >
                      {booking.booking_source}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Widget: Low Stock Alerts ── */}
        {lowStockVariants.length > 0 && (
          <div className="bg-white border border-red-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Low Stock Alerts
            </h2>
            <ul className="space-y-2">
              {lowStockVariants.map((variant) => (
                <li
                  key={variant.id}
                  className="flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {variant.product_name}
                      <span className="text-gray-500 font-normal">
                        {" "}
                        — {variant.size}
                      </span>
                    </p>
                    <p className="text-xs text-gray-400">
                      Threshold: {variant.low_stock_threshold}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-red-600 shrink-0 ml-3">
                    {variant.stock_quantity} left
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/admin/merch"
              className="mt-4 inline-block text-xs text-red-600 hover:underline"
            >
              Manage inventory →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
