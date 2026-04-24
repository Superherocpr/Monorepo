/**
 * ApprovalsHeader — Page header for /admin/sessions/approvals.
 * Displays the page title and total count of pending sessions.
 * Used by: ApprovalsPage (approvals/page.tsx)
 */

interface ApprovalsHeaderProps {
  /** Total number of sessions currently awaiting approval. */
  count: number;
}

/**
 * Renders the "Session Approvals" heading and a subtitle with the pending count.
 * @param count - Total pending sessions (resubmissions + new submissions)
 */
export default function ApprovalsHeader({ count }: ApprovalsHeaderProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-4 py-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900">Session Approvals</h1>
        <p className="mt-1 text-sm text-gray-500">
          {count} session{count !== 1 ? "s" : ""} awaiting approval
        </p>
      </div>
    </div>
  );
}
