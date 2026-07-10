/**
 * OpenOpportunitiesWidget — card listing cancelled sessions that have no
 * instructor yet, open for any instructor to claim first-come-first-serve.
 * Used by: InstructorDashboard.tsx
 */

import Link from "next/link";

/** A cancelled session with no instructor, open for any instructor to claim. */
export interface OpenOpportunity {
  id: string;
  starts_at: string;
  class_types: { name: string } | null;
  locations: { name: string; city: string } | null;
}

/**
 * Formats a timestamptz string as a readable date, e.g. "Jun 12, 2025".
 * @param timestamp - ISO timestamp string
 */
function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface OpenOpportunitiesWidgetProps {
  /** Cancelled, unclaimed sessions. Renders nothing when empty. */
  opportunities: OpenOpportunity[];
}

/**
 * Renders a card listing open (cancelled, unclaimed) sessions any instructor
 * can claim. Returns null when there are none so the grid collapses cleanly.
 * Once a session is claimed by anyone, the server query that feeds this widget
 * naturally excludes it on the next page load — no realtime sync needed.
 */
export default function OpenOpportunitiesWidget({
  opportunities,
}: OpenOpportunitiesWidgetProps) {
  if (opportunities.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Open Opportunities
      </h2>
      <ul className="space-y-3">
        {opportunities.map((session) => (
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
                  {formatDate(session.starts_at)}
                  {session.locations
                    ? ` · ${session.locations.name}, ${session.locations.city}`
                    : ""}
                </p>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0 ml-3">
                Open
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
