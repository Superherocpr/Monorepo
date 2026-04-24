/**
 * NewSubmissionsSection — Approvals queue section for fresh (never-rejected) sessions.
 * No rejection reason shown — these are first-time submissions.
 * Used by: ApprovalsPage (approvals/page.tsx)
 */

import ApprovalCard, { type PendingSession } from "./ApprovalCard";
import { getWaitTime, isWaitOver24Hours } from "../utils";

interface NewSubmissionsSectionProps {
  /** Sessions with no prior rejection (rejection_reason is null). */
  sessions: PendingSession[];
}

/**
 * Renders the new submissions section: h2 heading + one card per session.
 * Only rendered when newSubmissions.length > 0.
 * @param sessions - New sessions sorted longest-waiting first
 */
export default function NewSubmissionsSection({ sessions }: NewSubmissionsSectionProps) {
  if (sessions.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">New Submissions</h2>
      <div className="space-y-4">
        {sessions.map((session) => {
          const waitTime = getWaitTime(session.created_at);
          const isLongWait = isWaitOver24Hours(session.created_at);
          return (
            <ApprovalCard
              key={session.id}
              session={session}
              waitTime={waitTime}
              isLongWait={isLongWait}
              isResubmission={false}
            />
          );
        })}
      </div>
    </section>
  );
}
