"use client";

/**
 * ApprovalCard — Interactive card for a single pending session in the approvals queue.
 * Supports inline approve, reject (expandable reason textarea), and visual status transitions.
 * Status is managed by the parent section; local state covers only the rejection textarea.
 * Shared by ResubmissionsSection and NewSubmissionsSection.
 * Used by: approvals/_components/ResubmissionsSection, NewSubmissionsSection
 */

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle, XCircle, Loader2 } from "lucide-react";

/** Lifecycle state of a single approval card, managed by the parent section. */
export type CardStatus = "idle" | "loading" | "approved" | "rejected";

/** A pending session row joined from the DB, passed from the page into the card. */
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
  /** Wait time string pre-computed by the parent section (e.g. "3 days"). */
  waitTime: string;
  /** Whether the wait exceeds 24 hours — triggers amber styling. */
  isLongWait: boolean;
  /** True for resubmissions — shows amber accent and prior rejection reason. */
  isResubmission: boolean;
  /** Current lifecycle status managed by the parent section. */
  status: CardStatus;
  /**
   * Error message from a failed approve/reject action.
   * Shown inline on the card; action buttons remain active so the user can retry.
   */
  errorMsg?: string;
  /** Called when the manager clicks Approve — parent handles the server action. */
  onApprove: () => void;
  /** Called with the typed reason when manager confirms Reject — parent handles the server action. */
  onReject: (reason: string) => void;
}

/**
 * Formats a UTC ISO datetime string for display as "Day, Mon D · H:MM AM/PM".
 * @param iso - ISO 8601 date string.
 */
function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }) +
    " · " +
    d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  );
}

/**
 * Renders a single pending-approval session card.
 * The parent section controls `status`; this component manages only the rejection textarea.
 */
export default function ApprovalCard({
  session,
  waitTime,
  isLongWait,
  isResubmission,
  status,
  errorMsg,
  onApprove,
  onReject,
}: ApprovalCardProps): React.ReactElement {
  const [rejecting, setRejecting] = useState(false);
  const [rejectionText, setRejectionText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);

  const isLoading = status === "loading";
  const isApproved = status === "approved";
  const isRejected = status === "rejected";
  const isDone = isApproved || isRejected;

  /**
   * Validates the rejection reason length then delegates to the parent callback.
   * The parent sets status to "loading" on its side.
   */
  function handleRejectSubmit(): void {
    if (rejectionText.trim().length < 10) {
      setTextError("Reason must be at least 10 characters.");
      return;
    }
    setTextError(null);
    onReject(rejectionText.trim());
  }

  // Left accent border shifts color once a decision is made.
  const accentClass = isApproved
    ? "border-l-4 border-l-green-400"
    : isRejected
    ? "border-l-4 border-l-red-400"
    : isResubmission
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
      className={`bg-white border border-gray-200 rounded-lg p-5 flex flex-col gap-3 ${accentClass} transition-colors`}
    >
      {/* ── Session info ───────────────────────────────────────────────────── */}
      <div className={`flex flex-col gap-1 ${isDone ? "opacity-50" : ""}`}>
        <h3 className="font-semibold text-gray-900">
          {session.class_types?.name ?? "Unknown class"}
        </h3>
        <p className="text-sm text-gray-600">{formatSessionDate(session.starts_at)}</p>
        <p className="text-sm text-gray-500">{locationLabel}</p>
        <p className="text-sm text-gray-500">Instructor: {instructorName}</p>

        {!isDone &&
          (isLongWait || isResubmission ? (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-600">
              <AlertTriangle size={14} />
              Waiting {waitTime}
            </span>
          ) : (
            <span className="text-sm text-gray-400">Waiting {waitTime}</span>
          ))}

        {/* Prior rejection reason — resubmissions only, hidden once a new decision is made */}
        {isResubmission && session.rejection_reason && !isDone && (
          <div className="bg-red-50 border border-red-100 rounded px-3 py-2 text-sm text-red-700 mt-1">
            Previously rejected: {session.rejection_reason}
          </div>
        )}
      </div>

      {/* ── Approved state ─────────────────────────────────────────────────── */}
      {isApproved && (
        <div className="flex items-center gap-2 text-green-700 text-sm font-semibold">
          <CheckCircle size={16} className="shrink-0" />
          Approved
        </div>
      )}

      {/* ── Rejected state ─────────────────────────────────────────────────── */}
      {isRejected && (
        <div className="flex items-center gap-2 text-red-700 text-sm font-semibold">
          <XCircle size={16} className="shrink-0" />
          Rejected
        </div>
      )}

      {/* ── Action error — shown with buttons still active so manager can retry */}
      {errorMsg && !isDone && (
        <div className="bg-red-50 border border-red-100 rounded px-3 py-2 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* ── Rejection textarea ──────────────────────────────────────────────── */}
      {rejecting && !isDone && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">
            Rejection reason <span className="text-red-500">*</span>
            <span className="text-gray-400 font-normal"> (min 10 characters)</span>
          </label>
          <textarea
            value={rejectionText}
            onChange={(e) => {
              setRejectionText(e.target.value);
              setTextError(null);
            }}
            rows={3}
            maxLength={500}
            placeholder="Explain why this session is being rejected…"
            disabled={isLoading}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:opacity-50"
          />
          {textError && <p className="text-xs text-red-600">{textError}</p>}
        </div>
      )}

      {/* ── Card footer ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <Link
          href={`/admin/sessions/${session.id}`}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Details →
        </Link>

        {!isDone && (
          <div className="flex items-center gap-2">
            {isLoading && (
              <Loader2 size={15} className="animate-spin text-gray-400 shrink-0" />
            )}

            {rejecting ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setRejecting(false);
                    setRejectionText("");
                    setTextError(null);
                  }}
                  disabled={isLoading}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRejectSubmit}
                  disabled={isLoading}
                  className="px-4 py-1.5 rounded-md border border-red-300 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-40"
                >
                  Confirm Reject
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setRejecting(true)}
                  disabled={isLoading}
                  className="px-3 py-1.5 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={isLoading}
                  className="px-4 py-1.5 rounded-md bg-green-600 hover:bg-green-700 text-sm font-medium text-white transition-colors disabled:opacity-40"
                >
                  Approve
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
