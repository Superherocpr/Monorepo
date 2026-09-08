/**
 * PendingGradesWidget: card showing completed sessions where the instructor
 * still has ungraded roster students. Links to the grading page for each session.
 * Used by: InstructorDashboard.tsx, SuperAdminDashboard.tsx
 */

import Link from "next/link";
import { formatClassDate } from "@/lib/business-time";

/** A completed session where one or more roster students still need grades. */
export interface PendingGradeSession {
  id: string;
  starts_at: string;
  ungradedCount: number;
  class_types: { name: string } | null;
}

/**
 * Formats a class date, e.g. "Jun 12, 2025".
 * @param timestamp - Stored class timestamp
 */
function formatDate(timestamp: string): string {
  return formatClassDate(timestamp, { month: "short", weekday: false });
}

interface PendingGradesWidgetProps {
  /** Completed sessions with at least one ungraded student. Renders nothing when empty. */
  sessions: PendingGradeSession[];
}

/**
 * Renders a card listing sessions with ungraded roster students.
 * Returns null when there are no pending grades so the grid collapses cleanly.
 */
export default function PendingGradesWidget({ sessions }: PendingGradesWidgetProps) {
  if (sessions.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Pending Grades
      </h2>
      <ul className="space-y-3">
        {sessions.map((session) => (
          <li key={session.id}>
            <Link
              href={`/admin/sessions/${session.id}/grade`}
              className="flex items-start justify-between hover:bg-gray-50 -mx-2 px-2 py-2 rounded-md transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {session.class_types?.name ?? "Unknown Class"}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {formatDate(session.starts_at)}
                </p>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0 ml-3">
                {session.ungradedCount} ungraded
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
