/**
 * ApprovalCard — Single session card for the approvals queue.
 * Shared by both ResubmissionsSection and NewSubmissionsSection.
 * Used by: approvals/_components/ResubmissionsSection, NewSubmissionsSection
 */

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** A pending session row passed from the page into the card. */
export interface PendingSession {
  id: string;
  starts_at: string;
  ends_at: string;
  /** ISO string of when the session was submitted — used to compute wait time. */
  created_at: string;
  rejection_reason: string | null;
  class_types: { name: string } | null;
  /** Instructor profile joined as `profiles`. */
  profiles: { first_name: string; last_name: string } | null;
  locations: { name: string; city: string; state: string } | null;
}

interface ApprovalCardProps {
  session: PendingSession;
  /** Wait time string pre-computed by the page (e.g. "3 days", "5 hours"). */
  waitTime: string;
  /** Whether the wait time exceeds 24 hours — triggers amber styling. */
  isLongWait: boolean;
  /** True for resubmissions (amber accent + rejection reason shown). */
  isResubmission: boolean;
}

/**
 * Formats a UTC ISO date string for display as "Day, Mon DD YYYY · H:MM AM/PM".
 * @param iso - ISO 8601 date string
 */
function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }) + " · " + d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Renders a single pending-approval session card.
 * Left accent color and rejection reason differ between resubmissions and new submissions.
 * @param session - The pending session data with joined relations
 * @param waitTime - Pre-computed human-readable wait time
 * @param isLongWait - True if wait exceeds 24 hours (triggers amber text + icon)
 * @param isResubmission - True if session was previously rejected and resubmitted
 */
export default function ApprovalCard({
  session,
  waitTime,
  isLongWait,
  isResubmission,
}: ApprovalCardProps) {
  const accentClass = isResubmission
    ? "border-l-4 border-l-amber-400"
    : "border-l-4 border-l-blue-400";

  const instructorName = session.profiles
    ? `${session.profiles.first_name} ${session.profiles.last_name}`
    : "Unknown instructor";

  const locationLabel = session.locations
    ? `${session.locations.name} · ${session.locations.city}, ${session.locations.state}`
    : "Unknown location";

  return (
    <div
      className={`bg-white border border-gray-200 rounded-lg p-5 flex flex-col gap-3 ${accentClass}`}
    >
      {/* Card body */}
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold text-gray-900">
          {session.class_types?.name ?? "Unknown class"}
        </h3>
        <p className="text-sm text-gray-600">{formatSessionDate(session.starts_at)}</p>
        <p className="text-sm text-gray-500">{locationLabel}</p>
        <p className="text-sm text-gray-500">Instructor: {instructorName}</p>

        {/* Wait time */}
        {isLongWait || isResubmission ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-600">
            <AlertTriangle size={14} />
            Waiting {waitTime}
          </span>
        ) : (
          <span className="text-sm text-gray-400">Waiting {waitTime}</span>
        )}

        {/* Rejection reason — resubmissions only */}
        {isResubmission && session.rejection_reason && (
          <div className="bg-red-50 border border-red-100 rounded px-3 py-2 text-sm text-red-700 mt-2">
            Previously rejected: {session.rejection_reason}
          </div>
        )}
      </div>

      {/* Card footer */}
      <div className="flex justify-end pt-1">
        <Link
          href={`/admin/sessions/${session.id}`}
          className={`inline-flex items-center gap-1 px-4 py-1.5 rounded-md border text-sm font-medium transition-colors ${
            isResubmission
              ? "border-red-300 text-red-700 hover:bg-red-50"
              : "border-gray-300 text-gray-700 hover:bg-gray-50"
          }`}
        >
          Review &amp; Approve →
        </Link>
      </div>
    </div>
  );
}
