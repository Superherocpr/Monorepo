/**
 * SuperAdminDashboard — dashboard view for the super_admin role.
 * Extends the manager dashboard with a quick stats strip and recent activity feed.
 * Used by: app/(admin)/page.tsx
 */

import ManagerDashboard, {
  type ManagerDashboardProps,
} from "./ManagerDashboard";

/** The four top-level stats shown in the quick stats strip. */
export interface QuickStats {
  totalCustomers: number;
  classesThisMonth: number;
  onlineRevenueThisMonth: number;
  invoiceRevenueThisMonth: number;
}

/** A single item in the recent activity feed. */
export interface ActivityItem {
  id: string;
  type: "booking" | "payment" | "invoice" | "customer";
  description: string;
  created_at: string;
}

export interface SuperAdminDashboardProps extends ManagerDashboardProps {
  quickStats: QuickStats;
  recentActivity: ActivityItem[];
}

/** Icon labels per activity type — text-based since we're keeping deps minimal. */
const ACTIVITY_LABELS: Record<ActivityItem["type"], string> = {
  booking: "Booking",
  payment: "Payment",
  invoice: "Invoice",
  customer: "New Customer",
};

const ACTIVITY_COLORS: Record<ActivityItem["type"], string> = {
  booking: "bg-blue-100 text-blue-700",
  payment: "bg-green-100 text-green-700",
  invoice: "bg-purple-100 text-purple-700",
  customer: "bg-gray-100 text-gray-600",
};

/**
 * Formats a timestamptz string as a short relative time, e.g. "2h ago" or "3 days ago".
 * @param timestamp - ISO timestamp string
 */
function formatRelativeTime(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Formats a currency value as a USD string, e.g. "$1,234.56".
 * @param amount - Numeric revenue amount
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Role-specific dashboard for super admins. Renders quick stats + activity feed above the manager view. */
export default function SuperAdminDashboard({
  quickStats,
  recentActivity,
  ...managerProps
}: SuperAdminDashboardProps) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">
        Good morning, {managerProps.firstName}
      </h1>

      {/* ── Quick Stats Strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Total Customers
          </p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {quickStats.totalCustomers.toLocaleString()}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Class Sessions This Month
          </p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {quickStats.classesThisMonth}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Online Revenue (Mo.)
          </p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {formatCurrency(quickStats.onlineRevenueThisMonth)}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Invoice Revenue (Mo.)
          </p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {formatCurrency(quickStats.invoiceRevenueThisMonth)}
          </p>
        </div>
      </div>

      {/* ── Recent Activity Feed ── */}
      {recentActivity.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
            Recent Activity
          </h2>
          <ul className="divide-y divide-gray-100">
            {recentActivity.map((item) => (
              <li
                key={`${item.type}-${item.id}`}
                className="flex items-center justify-between py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={[
                      "text-xs font-semibold px-2 py-0.5 rounded-full shrink-0",
                      ACTIVITY_COLORS[item.type],
                    ].join(" ")}
                  >
                    {ACTIVITY_LABELS[item.type]}
                  </span>
                  <p className="text-sm text-gray-700">{item.description}</p>
                </div>
                <span className="text-xs text-gray-400 shrink-0 ml-4">
                  {formatRelativeTime(item.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Manager widgets (reused, greeting suppressed to avoid duplicate h1) ── */}
      <ManagerDashboard {...managerProps} hideGreeting />
    </div>
  );
}
