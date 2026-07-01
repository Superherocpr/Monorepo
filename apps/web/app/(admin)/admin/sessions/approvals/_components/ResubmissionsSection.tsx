"use client";

/**
 * ResubmissionsSection — Approvals queue section for previously-rejected sessions.
 * Manages inline approve/reject state for each card and bulk-approve for the whole section.
 * Shows an amber advisory banner reminding managers to review carefully.
 * Used by: ApprovalsPage (approvals/page.tsx)
 */

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import ApprovalCard, { type PendingSession, type CardStatus } from "./ApprovalCard";
import { approveSession, rejectSession, bulkApproveSession } from "../../[id]/actions";
import { getWaitTime, isWaitOver24Hours } from "../utils";

interface ResubmissionsSectionProps {
  /** Sessions that were previously rejected (rejection_reason is not null). */
  sessions: PendingSession[];
}

/**
 * Renders the resubmissions section with per-card inline actions and an Approve All button.
 * Card statuses and errors are tracked here so Approve All can update all cards at once.
 * @param sessions - Resubmitted sessions sorted longest-waiting first.
 */
export default function ResubmissionsSection({
  sessions,
}: ResubmissionsSectionProps): React.ReactElement | null {
  /** Per-card lifecycle status. Initialised to "idle" for every session. */
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>(
    Object.fromEntries(sessions.map((s) => [s.id, "idle" as CardStatus]))
  );
  /** Per-card error messages from failed server actions. */
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Error from a failed Approve All call. */
  const [bulkError, setBulkError] = useState<string | null>(null);
  /** True while the Approve All server action is in flight. */
  const [bulkApproving, setBulkApproving] = useState(false);

  if (sessions.length === 0) return null;

  // ── Per-card handlers ──────────────────────────────────────────────────────

  /**
   * Approves a single session. Sets status to "loading" while in flight;
   * transitions to "approved" on success or resets to "idle" with an error on failure.
   * @param id - Session UUID.
   */
  async function handleApprove(id: string): Promise<void> {
    setStatuses((prev) => ({ ...prev, [id]: "loading" }));
    const err = await approveSession(id);
    if (err) {
      setStatuses((prev) => ({ ...prev, [id]: "idle" }));
      setErrors((prev) => ({ ...prev, [id]: err }));
    } else {
      setStatuses((prev) => ({ ...prev, [id]: "approved" }));
      setErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  }

  /**
   * Rejects a single session with the given reason. Sets status to "loading" while
   * in flight; transitions to "rejected" on success or resets to "idle" with an error.
   * @param id - Session UUID.
   * @param reason - Rejection reason (already validated ≥ 10 chars by the card).
   */
  async function handleReject(id: string, reason: string): Promise<void> {
    setStatuses((prev) => ({ ...prev, [id]: "loading" }));
    const err = await rejectSession(id, reason);
    if (err) {
      setStatuses((prev) => ({ ...prev, [id]: "idle" }));
      setErrors((prev) => ({ ...prev, [id]: err }));
    } else {
      setStatuses((prev) => ({ ...prev, [id]: "rejected" }));
      setErrors((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  }

  // ── Approve All ────────────────────────────────────────────────────────────

  /**
   * Approves all resubmitted sessions still in "idle" status in a single batch request.
   * Cards transition to "loading" immediately, then to "approved" on success.
   * On failure the cards reset to "idle" and a section-level error is shown.
   */
  async function handleApproveAll(): Promise<void> {
    const idleIds = sessions
      .filter((s) => statuses[s.id] === "idle")
      .map((s) => s.id);
    if (idleIds.length === 0) return;

    setBulkApproving(true);
    setBulkError(null);
    setStatuses((prev) => ({
      ...prev,
      ...Object.fromEntries(idleIds.map((id) => [id, "loading" as CardStatus])),
    }));

    const err = await bulkApproveSession(idleIds);

    if (err) {
      setBulkError(err);
      setStatuses((prev) => ({
        ...prev,
        ...Object.fromEntries(
          idleIds.map((id) => [id, prev[id] === "loading" ? ("idle" as CardStatus) : prev[id]])
        ),
      }));
    } else {
      setStatuses((prev) => ({
        ...prev,
        ...Object.fromEntries(idleIds.map((id) => [id, "approved" as CardStatus])),
      }));
    }
    setBulkApproving(false);
  }

  const idleCount = sessions.filter((s) => statuses[s.id] === "idle").length;

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Resubmissions</h2>
        {idleCount > 1 && (
          <button
            type="button"
            onClick={handleApproveAll}
            disabled={bulkApproving}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-md bg-green-600 hover:bg-green-700 disabled:opacity-50 text-sm font-medium text-white transition-colors"
          >
            {bulkApproving && <Loader2 size={13} className="animate-spin" />}
            Approve All ({idleCount})
          </button>
        )}
      </div>

      {/* Advisory banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 flex items-start gap-3">
        <AlertTriangle className="text-amber-600 mt-0.5 shrink-0" size={18} />
        <p className="text-sm text-amber-800 font-medium">
          These sessions were previously rejected and have been updated by the instructor. Review the
          prior rejection reason on each card before approving.
        </p>
      </div>

      {/* Bulk error */}
      {bulkError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {bulkError}
        </div>
      )}

      <div className="space-y-4">
        {sessions.map((session) => (
          <ApprovalCard
            key={session.id}
            session={session}
            waitTime={getWaitTime(session.created_at)}
            isLongWait={isWaitOver24Hours(session.created_at)}
            isResubmission
            status={statuses[session.id] ?? "idle"}
            errorMsg={errors[session.id]}
            onApprove={() => handleApprove(session.id)}
            onReject={(reason) => handleReject(session.id, reason)}
          />
        ))}
      </div>
    </section>
  );
}
