/**
 * PendingInvoicesWidget: card showing outstanding invoices the instructor
 * has submitted but not yet been paid for. Links to each invoice detail page.
 * Used by: InstructorDashboard.tsx, SuperAdminDashboard.tsx
 */

import Link from "next/link";

/** An outstanding invoice the instructor has not yet been paid for. */
export interface PendingInvoice {
  id: string;
  recipient_name: string;
  total_amount: number;
  created_at: string;
  class_sessions: {
    starts_at: string;
    class_types: { name: string } | null;
  } | null;
}

/**
 * Formats a timestamptz string as a readable date, e.g. "Jun 12, 2025".
 * @param timestamp - ISO timestamp string
 */
function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    timeZone: "UTC", // class times are floating wall-clock values
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Returns how many days have passed since the given ISO timestamp.
 * @param timestamp - ISO timestamp string
 */
function daysSince(timestamp: string): number {
  const ms = Date.now() - new Date(timestamp).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

interface PendingInvoicesWidgetProps {
  /** Sent-but-unpaid invoices. Renders nothing when empty. */
  invoices: PendingInvoice[];
}

/**
 * Renders a card listing outstanding unpaid invoices.
 * Returns null when there are no pending invoices so the grid collapses cleanly.
 */
export default function PendingInvoicesWidget({ invoices }: PendingInvoicesWidgetProps) {
  if (invoices.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Pending Invoices
      </h2>
      <ul className="space-y-3">
        {invoices.map((invoice) => (
          <li key={invoice.id}>
            <Link
              href={`/admin/invoices/${invoice.id}`}
              className="flex items-start justify-between hover:bg-gray-50 -mx-2 px-2 py-2 rounded-md transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {invoice.recipient_name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {invoice.class_sessions?.class_types?.name ?? "-"} ·{" "}
                  {invoice.class_sessions
                    ? formatDate(invoice.class_sessions.starts_at)
                    : "-"}
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-sm font-semibold text-gray-900">
                  ${Number(invoice.total_amount).toFixed(2)}
                </p>
                <p className="text-xs text-gray-400">
                  {daysSince(invoice.created_at)}d ago
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
