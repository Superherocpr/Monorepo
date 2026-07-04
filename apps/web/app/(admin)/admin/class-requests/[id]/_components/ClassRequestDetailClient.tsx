"use client";

/**
 * ClassRequestDetailClient — interactive detail view for a class request.
 * Handles Approve (→ API, then redirect to created session) and Reject
 * (requires a reason ≥ 10 chars) actions for pending requests.
 * Used by: /admin/class-requests/[id]/page.tsx
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ClassRequest } from "@/types/class-requests";
import { CLASS_REQUEST_STATUS_LABELS, PREFERRED_TIME_LABELS } from "@/types/class-requests";

/** Badge colour mapping per status. */
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  approved: "bg-blue-100 text-blue-800 border-blue-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  instructor_assigned: "bg-green-100 text-green-800 border-green-200",
};

interface Props {
  /** The class request to display. */
  request: ClassRequest;
}

/** Renders full details and Approve/Reject controls for a class request. */
export default function ClassRequestDetailClient({ request }: Props) {
  const router = useRouter();
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const statusLabel = CLASS_REQUEST_STATUS_LABELS[request.status] ?? request.status;
  const statusStyle = STATUS_STYLES[request.status] ?? "bg-gray-100 text-gray-700";
  const timeLabel = PREFERRED_TIME_LABELS[request.preferred_time_of_day] ?? request.preferred_time_of_day;

  const customer = request.profiles;
  const classType = request.class_types;

  const formattedPreferredDate = new Date(request.preferred_date + "T12:00:00Z").toLocaleDateString(
    "en-US",
    { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }
  );

  /**
   * Approves the request by calling POST /api/class-requests/[id]/approve.
   * On success, redirects to the newly created session's detail page.
   */
  async function handleApprove() {
    setApproving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/class-requests/${request.id}/approve`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "Failed to approve request.");
        return;
      }
      // Redirect to the created session so admin can review and adjust if needed
      router.push(`/admin/sessions/${json.data.sessionId}`);
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setApproving(false);
    }
  }

  /**
   * Submits the rejection with the provided reason.
   * Validates that the reason is at least 10 characters before sending.
   */
  async function handleReject() {
    setRejectError(null);
    if (rejectReason.trim().length < 10) {
      setRejectError("Please provide a reason of at least 10 characters.");
      return;
    }
    setRejecting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/class-requests/${request.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "Failed to reject request.");
        return;
      }
      router.push("/admin/class-requests");
      router.refresh();
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status badge */}
      <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${statusStyle}`}>
        {statusLabel}
      </div>

      {/* Customer info */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Customer</h2>
        {customer ? (
          <dl className="space-y-2">
            <div className="flex gap-3">
              <dt className="text-sm text-gray-500 w-20 shrink-0">Name</dt>
              <dd className="text-sm font-medium text-gray-900">
                {customer.first_name} {customer.last_name}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="text-sm text-gray-500 w-20 shrink-0">Email</dt>
              <dd className="text-sm text-gray-900">
                <a href={`mailto:${customer.email}`} className="text-red-600 hover:underline">
                  {customer.email}
                </a>
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-gray-500">Customer data unavailable.</p>
        )}
      </div>

      {/* Class details */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Class Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Class Type</dt>
            <dd className="text-sm font-medium text-gray-900">
              {classType?.name ?? "—"}
              {classType?.duration_minutes && (
                <span className="text-gray-400 font-normal">
                  {" "}
                  ({classType.duration_minutes % 60 === 0
                    ? `${classType.duration_minutes / 60} hr${classType.duration_minutes / 60 !== 1 ? "s" : ""}`
                    : `${Math.floor(classType.duration_minutes / 60)} hr ${classType.duration_minutes % 60} min`})
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Base Price</dt>
            <dd className="text-sm font-medium text-gray-900">
              ${classType?.price != null ? Number(classType.price).toFixed(2) : "—"} / student
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Preferred Date</dt>
            <dd className="text-sm font-medium text-gray-900">{formattedPreferredDate}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Preferred Time</dt>
            <dd className="text-sm font-medium text-gray-900">{timeLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Group Size</dt>
            <dd className="text-sm font-medium text-gray-900">~{request.group_size} attendees</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Travel &amp; Setup Fee</dt>
            <dd className="text-sm font-semibold text-gray-900">${Number(request.travel_fee).toFixed(2)}</dd>
          </div>
        </dl>
      </div>

      {/* Venue */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Venue</h2>
        <dl className="space-y-2">
          <div className="flex gap-3">
            <dt className="text-sm text-gray-500 w-24 shrink-0">Venue Name</dt>
            <dd className="text-sm font-medium text-gray-900">{request.venue_name}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-sm text-gray-500 w-24 shrink-0">Address</dt>
            <dd className="text-sm text-gray-900">
              {request.venue_address}<br />
              {request.venue_city}, {request.venue_state} {request.venue_zip}
            </dd>
          </div>
        </dl>
      </div>

      {/* Notes */}
      {request.notes && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Additional Notes</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{request.notes}</p>
        </div>
      )}

      {/* Rejection reason (if rejected) */}
      {request.status === "rejected" && request.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wide mb-2">Rejection Reason</h2>
          <p className="text-sm text-red-800">{request.rejection_reason}</p>
        </div>
      )}

      {/* Linked session (if approved/assigned) */}
      {request.session_id && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-blue-900">Session created from this request</p>
            <p className="text-xs text-blue-700 mt-0.5">You can edit the time, adjust capacity, or view roster from the session detail page.</p>
          </div>
          <Link
            href={`/admin/sessions/${request.session_id}`}
            className="shrink-0 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            View Session →
          </Link>
        </div>
      )}

      {/* Actions for pending requests */}
      {request.status === "pending" && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Actions</h2>

          {actionError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{actionError}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {/* Approve */}
            <button
              onClick={handleApprove}
              disabled={approving || rejecting}
              className="bg-green-600 text-white font-semibold px-5 py-2.5 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {approving ? "Approving…" : "Approve & Create Session"}
            </button>

            {/* Reject toggle */}
            {!showRejectForm && (
              <button
                onClick={() => setShowRejectForm(true)}
                disabled={approving}
                className="border border-red-300 text-red-600 font-semibold px-5 py-2.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 text-sm"
              >
                Reject
              </button>
            )}
          </div>

          {/* Inline rejection reason form */}
          {showRejectForm && (
            <div className="mt-5 border-t border-gray-100 pt-5">
              <label
                htmlFor="reject-reason"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Rejection Reason <span className="text-red-500">*</span>
                <span className="text-gray-400 font-normal ml-1">(shown to the customer)</span>
              </label>
              <textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value);
                  setRejectError(null);
                }}
                rows={3}
                placeholder="Explain why this request cannot be fulfilled (min 10 characters)…"
                className={[
                  "block w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-y",
                  rejectError ? "border-red-400" : "border-gray-300",
                ].join(" ")}
              />
              {rejectError && (
                <p className="text-red-500 text-xs mt-1">{rejectError}</p>
              )}
              <div className="flex gap-3 mt-3">
                <button
                  onClick={handleReject}
                  disabled={rejecting || approving}
                  className="bg-red-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 text-sm"
                >
                  {rejecting ? "Rejecting…" : "Confirm Rejection"}
                </button>
                <button
                  onClick={() => {
                    setShowRejectForm(false);
                    setRejectReason("");
                    setRejectError(null);
                  }}
                  disabled={rejecting}
                  className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
