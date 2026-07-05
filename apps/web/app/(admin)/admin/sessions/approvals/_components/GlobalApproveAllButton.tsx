"use client";

/**
 * GlobalApproveAllButton — approves every pending session in the queue in one action.
 * Sits at the bottom of the approvals page as a shortcut when the manager wants to
 * clear the entire queue without reviewing each card individually.
 * On success, router.refresh() re-renders the page — if the queue is now empty the
 * empty state is shown; any sessions approved individually beforehand are already gone.
 * Used by: approvals/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { bulkApproveSession } from "../../[id]/actions";

interface GlobalApproveAllButtonProps {
  /** UUIDs of every session currently shown in the queue. */
  sessionIds: string[];
}

/**
 * Renders a full-width "Approve All" button that bulk-approves every pending session.
 * @param sessionIds - All pending session UUIDs to approve.
 */
export default function GlobalApproveAllButton({
  sessionIds,
}: GlobalApproveAllButtonProps): React.ReactElement {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Calls bulkApproveSession for all pending IDs, then refreshes the page.
   * The page will re-render with an empty queue (or show whichever sessions remain
   * if some were individually rejected before this was clicked).
   */
  async function handleApproveAll(): Promise<void> {
    setLoading(true);
    setError(null);
    const err = await bulkApproveSession(sessionIds);
    if (err) {
      setError(err);
      setLoading(false);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 pt-2 pb-8">
      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 w-full text-center">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleApproveAll}
        disabled={loading}
        className="inline-flex items-center gap-2 px-8 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        {loading ? "Approving all…" : `Approve All ${sessionIds.length} Sessions`}
      </button>
    </div>
  );
}
