/**
 * ApprovalsEmptyState — Empty state for /admin/sessions/approvals.
 * Shown when no sessions are pending approval.
 * Used by: ApprovalsPage (approvals/page.tsx)
 */

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

/**
 * Full-page empty state indicating the approvals queue is clear.
 * Provides a link back to the sessions list.
 */
export default function ApprovalsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <CheckCircle2 className="text-green-500 mb-4" size={48} />
      <h2 className="text-xl font-semibold text-gray-900 mb-2">All caught up!</h2>
      <p className="text-gray-500 mb-6">No sessions are currently awaiting approval.</p>
      <Link
        href="/admin/sessions"
        className="text-sm font-medium text-blue-600 hover:text-blue-800 underline underline-offset-2"
      >
        View all sessions
      </Link>
    </div>
  );
}
