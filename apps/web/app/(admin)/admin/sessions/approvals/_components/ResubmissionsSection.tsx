/**
 * ResubmissionsSection — Approvals queue section for previously-rejected sessions.
 * Shows an amber warning banner above the cards.
 * Used by: ApprovalsPage (approvals/page.tsx)
 */

import { AlertTriangle } from "lucide-react";
import ApprovalCard, { type PendingSession } from "./ApprovalCard";
import { getWaitTime, isWaitOver24Hours } from "../utils";

interface ResubmissionsSectionProps {
  /** Sessions that were previously rejected (rejection_reason is not null). */
  sessions: PendingSession[];
}

/**
 * Renders the resubmissions section: amber advisory banner + one card per session.
 * Only rendered when resubmissions.length > 0.
 * @param sessions - Resubmitted sessions sorted longest-waiting first
 */
export default function ResubmissionsSection({ sessions }: ResubmissionsSectionProps) {
  if (sessions.length === 0) return null;

  return (
    <section>
      {/* Advisory banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 flex items-start gap-3">
        <AlertTriangle className="text-amber-600 mt-0.5 shrink-0" size={18} />
        <p className="text-sm text-amber-800 font-medium">
          Resubmissions — These classes were previously rejected and have been updated.
          Review carefully.
        </p>
      </div>

      <div className="space-y-4">
        {sessions.map((session) => {
          const waitTime = getWaitTime(session.updated_at);
          const isLongWait = isWaitOver24Hours(session.updated_at);
          return (
            <ApprovalCard
              key={session.id}
              session={session}
              waitTime={waitTime}
              isLongWait={isLongWait}
              isResubmission
            />
          );
        })}
      </div>
    </section>
  );
}
