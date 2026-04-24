"use client";

/**
 * SessionDetailClient — full interactive UI for the admin session detail page.
 * Handles approval, rejection, editing, cancellation, CSV export, and all inline forms.
 * Used by: app/(admin)/admin/sessions/[id]/page.tsx
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { UserRole } from "@/types/users";
import type { SessionStatus, SessionApprovalStatus } from "@/types/schedule";
import {
  approveSession,
  rejectSession,
  cancelSession,
  updateSession,
  type SessionEditFields,
} from "@/app/(admin)/admin/sessions/[id]/actions";

// ─── Exported types (imported by the server component) ────────────────────────

/** A booking row joined with customer profile and payments, as returned by the page query. */
export interface SessionBooking {
  id: string;
  cancelled: boolean;
  booking_source: string;
  grade: number | null;
  profiles: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
  } | null;
  payments: Array<{ status: string; payment_type: string; amount: number }>;
}

/** A roster record row from the session query. */
export interface SessionRosterRecord {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
  grade: number | null;
  confirmed: boolean;
}

/** An invoice row from the session query. */
export interface SessionInvoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  recipient_name: string;
  recipient_email: string;
  company_name: string | null;
  student_count: number;
  total_amount: number;
  status: string;
  created_at: string;
}

/** A roster upload row from the session query. */
export interface SessionRosterUpload {
  id: string;
  original_filename: string;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  imported: boolean;
  created_at: string;
}

/** Full session detail shape passed from the server component. */
export interface SessionDetailData {
  id: string;
  starts_at: string;
  ends_at: string;
  status: SessionStatus;
  approval_status: SessionApprovalStatus;
  rejection_reason: string | null;
  max_capacity: number;
  notes: string | null;
  enrollware_submitted: boolean;
  roster_imported: boolean;
  correction_window_closes_at: string | null;
  class_type_id: string;
  instructor_id: string;
  location_id: string;
  class_types: { id: string; name: string; price: number; duration_minutes: number } | null;
  instructor: { id: string; first_name: string; last_name: string } | null;
  locations: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  bookings: SessionBooking[];
  roster_records: SessionRosterRecord[];
  invoices: SessionInvoice[];
  roster_uploads: SessionRosterUpload[];
}

/** A class type option for the edit form dropdown. */
export interface ClassTypeOption {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
}

/** A location option for the edit form dropdown. */
export interface LocationOption {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

/** An instructor option for the edit form dropdown (manager/super admin only). */
export interface InstructorOption {
  id: string;
  first_name: string;
  last_name: string;
}

// ─── Component props ──────────────────────────────────────────────────────────

interface Props {
  session: SessionDetailData;
  userId: string;
  userRole: UserRole;
  classTypes: ClassTypeOption[];
  locations: LocationOption[];
  instructors: InstructorOption[];
}

// ─── Badge helper functions ───────────────────────────────────────────────────

/**
 * Returns Tailwind classes for a session status badge.
 * @param status - The session status value.
 */
function sessionStatusBadgeClass(status: SessionStatus): string {
  const map: Record<SessionStatus, string> = {
    scheduled: "bg-blue-100 text-blue-700",
    in_progress: "bg-amber-100 text-amber-700",
    completed: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return map[status] ?? "bg-gray-100 text-gray-700";
}

/**
 * Returns a human-readable label for a session status value.
 * @param status - The session status value.
 */
function sessionStatusLabel(status: SessionStatus): string {
  const map: Record<SessionStatus, string> = {
    scheduled: "Scheduled",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return map[status] ?? status;
}

/**
 * Returns Tailwind classes for an approval status badge.
 * @param status - The approval status value.
 */
function approvalBadgeClass(status: SessionApprovalStatus): string {
  const map: Record<SessionApprovalStatus, string> = {
    pending_approval: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
  };
  return map[status] ?? "bg-gray-100 text-gray-700";
}

/**
 * Returns a human-readable label for an approval status value.
 * @param status - The approval status value.
 */
function approvalStatusLabel(status: SessionApprovalStatus): string {
  const map: Record<SessionApprovalStatus, string> = {
    pending_approval: "Pending Approval",
    approved: "Approved",
    rejected: "Rejected",
  };
  return map[status] ?? status;
}

/**
 * Returns Tailwind classes for a booking source badge.
 * @param source - The booking_source value (online, invoice, rollcall, roster, manual).
 */
function sourceBadgeClass(source: string): string {
  const map: Record<string, string> = {
    online: "bg-blue-100 text-blue-700",
    invoice: "bg-purple-100 text-purple-700",
    rollcall: "bg-amber-100 text-amber-700",
    roster: "bg-green-100 text-green-700",
    manual: "bg-gray-100 text-gray-700",
  };
  return map[source] ?? "bg-gray-100 text-gray-700";
}

/**
 * Returns Tailwind classes for an invoice status badge.
 * @param status - The invoice status value (sent, paid, cancelled).
 */
function invoiceStatusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    sent: "bg-blue-100 text-blue-700",
    paid: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return map[status] ?? "bg-gray-100 text-gray-700";
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Formats an ISO timestamp for display. Returns e.g. "Mon, Apr 21, 2026 — 9:00 AM".
 * @param iso - ISO datetime string from the database.
 */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Converts an ISO timestamp to the format expected by a datetime-local input.
 * Example: "2026-04-21T14:00:00+00:00" → "2026-04-21T14:00"
 * @param iso - ISO datetime string.
 */
function toDatetimeLocal(iso: string): string {
  return iso.slice(0, 16);
}

/**
 * Triggers a CSV file download in the browser with the given content.
 * @param content - The CSV string content.
 * @param filename - The suggested filename for the download.
 */
function downloadFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Renders the full session detail page UI with all interactive sections.
 * Sections are role-gated per the admin page guide.
 */
export default function SessionDetailClient({
  session,
  userId,
  userRole,
  classTypes,
  locations,
  instructors,
}: Props) {
  const router = useRouter();

  const isInstructor = userRole === "instructor";
  const isManager = userRole === "manager" || userRole === "super_admin";
  const isSuperAdmin = userRole === "super_admin";
  const isOwnSession = session.instructor_id === userId;

  // Whether the current user can see the invoices section
  const canSeeInvoices = isSuperAdmin || (isInstructor && isOwnSession);

  // Whether the current user can use grading and enrollware tools
  const canUseTools = isSuperAdmin || (isInstructor && isOwnSession);

  // ── UI state ──────────────────────────────────────────────────────────────

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showApproveEditWarning, setShowApproveEditWarning] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);

  const [rejectReason, setRejectReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);

  // ── Edit form state (pre-populated from session data) ─────────────────────

  const [editClassTypeId, setEditClassTypeId] = useState(
    session.class_type_id
  );
  const [editInstructorId, setEditInstructorId] = useState(
    session.instructor_id
  );
  const [editLocationId, setEditLocationId] = useState(session.location_id);
  const [editStartsAt, setEditStartsAt] = useState(
    toDatetimeLocal(session.starts_at)
  );
  const [editEndsAt, setEditEndsAt] = useState(
    toDatetimeLocal(session.ends_at)
  );
  const [editMaxCapacity, setEditMaxCapacity] = useState(session.max_capacity);
  const [editNotes, setEditNotes] = useState(session.notes ?? "");

  // ── Derived values ────────────────────────────────────────────────────────

  /** Non-cancelled bookings count */
  const activeBookings = useMemo(
    () => session.bookings.filter((b) => !b.cancelled).length,
    [session.bookings]
  );

  /** Total students (active bookings + roster records) */
  const totalStudents = activeBookings + session.roster_records.length;

  /** Students who have been graded */
  const gradedCount = useMemo(() => {
    const fromBookings = session.bookings.filter(
      (b) => !b.cancelled && b.grade !== null
    ).length;
    const fromRoster = session.roster_records.filter(
      (r) => r.grade !== null
    ).length;
    return fromBookings + fromRoster;
  }, [session.bookings, session.roster_records]);

  /** Roster upload waiting to be imported, if any */
  const pendingRosterUpload = useMemo(
    () => session.roster_uploads.find((u) => !u.imported) ?? null,
    [session.roster_uploads]
  );

  // ── Action handlers ───────────────────────────────────────────────────────

  /**
   * Approves the session. Direct action, no confirmation required.
   * Side effect: DB update via server action, page refresh on success.
   */
  async function handleApprove() {
    setIsApproving(true);
    setActionError(null);
    const error = await approveSession(session.id);
    setIsApproving(false);
    if (error) {
      setActionError(error);
    } else {
      router.refresh();
    }
  }

  /**
   * Submits the rejection form. Validates min length before calling server action.
   * Side effect: DB update via server action, form hidden, page refresh on success.
   */
  async function handleReject() {
    setIsRejecting(true);
    setActionError(null);
    const error = await rejectSession(session.id, rejectReason);
    setIsRejecting(false);
    if (error) {
      setActionError(error);
    } else {
      setShowRejectForm(false);
      setRejectReason("");
      router.refresh();
    }
  }

  /**
   * Submits the cancellation form. Validates min length before calling server action.
   * Side effect: DB update via server action, form hidden, page refresh on success.
   */
  async function handleCancel() {
    setIsCancelling(true);
    setActionError(null);
    const error = await cancelSession(session.id, cancelReason);
    setIsCancelling(false);
    if (error) {
      setActionError(error);
    } else {
      setShowCancelForm(false);
      setCancelReason("");
      router.refresh();
    }
  }

  /**
   * Handles the Edit button click.
   * If the session is approved, shows the warning before revealing the form.
   * Otherwise, shows the edit form directly.
   */
  function handleEditClick() {
    if (session.approval_status === "approved") {
      setShowApproveEditWarning(true);
    } else {
      setShowEditForm(true);
    }
  }

  /**
   * Submits the edit form. Resets approval if the session was previously approved.
   * Side effect: DB update via server action, form hidden, page refresh on success.
   */
  async function handleSaveEdit() {
    setIsSavingEdit(true);
    setActionError(null);
    const fields: SessionEditFields = {
      class_type_id: editClassTypeId,
      instructor_id: editInstructorId,
      location_id: editLocationId,
      starts_at: editStartsAt,
      ends_at: editEndsAt,
      max_capacity: editMaxCapacity,
      notes: editNotes,
    };
    const wasApproved = session.approval_status === "approved";
    const error = await updateSession(session.id, fields, wasApproved);
    setIsSavingEdit(false);
    if (error) {
      setActionError(error);
    } else {
      setShowEditForm(false);
      router.refresh();
    }
  }

  /**
   * Builds and downloads a CSV of all students in this session.
   * Combines active bookings (with customer profiles) and roster records.
   * Available to super admins on completed sessions only.
   */
  function handleExportCSV() {
    const headers = [
      "First Name",
      "Last Name",
      "Email",
      "Phone",
      "Employer",
      "Grade",
      "Source",
    ];

    const fromBookings = session.bookings
      .filter((b) => !b.cancelled)
      .map((b) => [
        b.profiles?.first_name ?? "",
        b.profiles?.last_name ?? "",
        b.profiles?.email ?? "",
        b.profiles?.phone ?? "",
        "",
        b.grade?.toString() ?? "",
        b.booking_source,
      ]);

    const fromRoster = session.roster_records.map((r) => [
      r.first_name,
      r.last_name,
      r.email ?? "",
      r.phone ?? "",
      r.employer ?? "",
      r.grade?.toString() ?? "",
      "roster",
    ]);

    const rows = [headers, ...fromBookings, ...fromRoster];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const date = new Date(session.starts_at).toISOString().slice(0, 10);
    const className = session.class_types?.name ?? "session";
    downloadFile(csv, `${className}-${date}-students.csv`);
  }

  // ── Can edit logic ────────────────────────────────────────────────────────

  const canEdit =
    isManager ||
    (isInstructor &&
      isOwnSession &&
      session.approval_status !== "approved");

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Global action error banner ── */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* ══ Section 1: Header ══ */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">

        {/* Title row */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {session.class_types?.name ?? "Class Session"}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {formatDateTime(session.starts_at)} — {formatDateTime(session.ends_at)}
            </p>
          </div>

          {/* Badge strip */}
          <div className="flex flex-wrap gap-2 shrink-0">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${approvalBadgeClass(session.approval_status)}`}
            >
              {approvalStatusLabel(session.approval_status)}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${sessionStatusBadgeClass(session.status)}`}
            >
              {sessionStatusLabel(session.status)}
            </span>
            {session.enrollware_submitted && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                Submitted to Enrollware
              </span>
            )}
          </div>
        </div>

        {/* Session meta */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Instructor
            </p>
            <p className="text-gray-800 mt-0.5">
              {session.instructor
                ? `${session.instructor.first_name} ${session.instructor.last_name}`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Location
            </p>
            {session.locations ? (
              <div className="text-gray-800 mt-0.5">
                <p>{session.locations.name}</p>
                <p className="text-gray-500">
                  {session.locations.address},{" "}
                  {session.locations.city}, {session.locations.state}{" "}
                  {session.locations.zip}
                </p>
              </div>
            ) : (
              <p className="text-gray-800 mt-0.5">—</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Capacity
            </p>
            <p className="text-gray-800 mt-0.5">
              {activeBookings} / {session.max_capacity} students
            </p>
          </div>
        </div>

        {/* Rejection reason — shown when session is rejected */}
        {session.approval_status === "rejected" && session.rejection_reason && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
            <p className="font-medium">This session was not approved.</p>
            <p className="mt-1">Reason: {session.rejection_reason}</p>
            {isInstructor && isOwnSession && (
              <button
                type="button"
                onClick={handleEditClick}
                className="mt-2 text-red-700 underline hover:text-red-900 text-xs font-medium"
              >
                Edit this session and resubmit for approval →
              </button>
            )}
          </div>
        )}

        {/* ── Approve edit warning (shown before revealing edit form for approved sessions) ── */}
        {showApproveEditWarning && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800 space-y-3">
            <p className="font-medium">
              Editing this session will reset it to pending approval and remove
              it from the public schedule until re-approved.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowApproveEditWarning(false);
                  setShowEditForm(true);
                }}
                className="px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-md hover:bg-amber-700 transition-colors"
              >
                Confirm — Edit Anyway
              </button>
              <button
                type="button"
                onClick={() => setShowApproveEditWarning(false)}
                className="px-3 py-1.5 bg-white border border-amber-300 text-amber-800 text-xs font-semibold rounded-md hover:bg-amber-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Inline edit form ── */}
        {showEditForm && (
          <div className="border border-gray-200 rounded-md p-4 space-y-4 bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-900">
              Edit Class Session
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Class type */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Class Type
                </label>
                <select
                  value={editClassTypeId}
                  onChange={(e) => setEditClassTypeId(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {classTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Instructor — manager/super admin only can change */}
              {isManager && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Instructor
                  </label>
                  <select
                    value={editInstructorId}
                    onChange={(e) => setEditInstructorId(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {instructors.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.first_name} {inst.last_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Location */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Location
                </label>
                <select
                  value={editLocationId}
                  onChange={(e) => setEditLocationId(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Max capacity */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Max Capacity
                </label>
                <input
                  type="number"
                  min={1}
                  value={editMaxCapacity}
                  onChange={(e) =>
                    setEditMaxCapacity(parseInt(e.target.value, 10) || 1)
                  }
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* Start date/time */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Start Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={editStartsAt}
                  onChange={(e) => setEditStartsAt(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* End date/time */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  End Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={editEndsAt}
                  onChange={(e) => setEditEndsAt(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Notes (internal)
              </label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 resize-y"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSavingEdit}
                className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isSavingEdit ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => setShowEditForm(false)}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Header action buttons ── */}
        {!showEditForm && !showApproveEditWarning && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">

            {/* Approval actions — manager/super admin only, pending sessions only */}
            {isManager && session.approval_status === "pending_approval" && (
              <>
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={isApproving}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {isApproving ? "Approving…" : "Approve"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowRejectForm(!showRejectForm);
                    setActionError(null);
                  }}
                  className="px-4 py-2 bg-white border border-red-300 text-red-600 text-sm font-semibold rounded-md hover:bg-red-50 transition-colors"
                >
                  Reject
                </button>
              </>
            )}

            {/* Edit button */}
            {canEdit && (
              <button
                type="button"
                onClick={handleEditClick}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors"
              >
                Edit
              </button>
            )}

            {/* Cancel session — manager/super admin only, non-cancelled sessions */}
            {isManager && session.status !== "cancelled" && (
              <button
                type="button"
                onClick={() => {
                  setShowCancelForm(!showCancelForm);
                  setActionError(null);
                }}
                className="px-4 py-2 bg-white border border-red-300 text-red-600 text-sm font-semibold rounded-md hover:bg-red-50 transition-colors"
              >
                Cancel Session
              </button>
            )}
          </div>
        )}

        {/* ── Inline rejection form ── */}
        {showRejectForm && (
          <div className="border border-red-200 rounded-md p-4 space-y-3 bg-red-50">
            <h3 className="text-sm font-semibold text-red-900">
              Rejection Reason
            </h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why this session is being rejected (min 10 characters)…"
              rows={3}
              className="w-full text-sm border border-red-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 resize-y bg-white"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleReject}
                disabled={isRejecting || rejectReason.trim().length < 10}
                className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isRejecting ? "Rejecting…" : "Confirm Rejection"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRejectForm(false);
                  setRejectReason("");
                }}
                className="px-4 py-2 bg-white border border-red-300 text-red-700 text-sm font-semibold rounded-md hover:bg-red-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Inline cancel session form ── */}
        {showCancelForm && (
          <div className="border border-red-200 rounded-md p-4 space-y-3 bg-red-50">
            <h3 className="text-sm font-semibold text-red-900">
              Cancel This Session?
            </h3>
            <p className="text-sm text-red-700">
              This cannot be undone. All booked students will be notified.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation (min 10 characters)…"
              rows={3}
              className="w-full text-sm border border-red-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500 resize-y bg-white"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancel}
                disabled={isCancelling || cancelReason.trim().length < 10}
                className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isCancelling ? "Cancelling…" : "Confirm Cancellation"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCancelForm(false);
                  setCancelReason("");
                }}
                className="px-4 py-2 bg-white border border-red-300 text-red-700 text-sm font-semibold rounded-md hover:bg-red-50 transition-colors"
              >
                Keep Session
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Desktop two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ══ Section 2: Students (left, 2 cols) ══ */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">
                Students
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({totalStudents})
                </span>
              </h2>
              {/* Import Roster button — manager/super admin only */}
              {isManager && (
                <Link
                  href={`/admin/sessions/${session.id}/roster`}
                  className="text-sm font-medium text-red-600 hover:text-red-700"
                >
                  Import Roster
                </Link>
              )}
            </div>

            {/* Pending roster upload banner */}
            {pendingRosterUpload && (
              <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between gap-4">
                <p className="text-sm text-amber-800">
                  A customer roster has been submitted and is ready to import.
                </p>
                <Link
                  href={`/admin/sessions/${session.id}/roster`}
                  className="shrink-0 text-sm font-semibold text-amber-800 underline hover:text-amber-900"
                >
                  Import
                </Link>
              </div>
            )}

            {/* Rollcall info note */}
            <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
              Students register via rollcall at superherocpr.com/rollcall using
              the instructor&apos;s daily class code.
            </div>

            {/* Students table */}
            {totalStudents === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-gray-400">
                No students yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-6 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Name
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Email
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Source
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Payment
                      </th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Grade
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {/* Rows from bookings (non-cancelled) */}
                    {session.bookings
                      .filter((b) => !b.cancelled)
                      .map((b) => (
                        <tr key={`booking-${b.id}`} className="hover:bg-gray-50">
                          <td className="px-6 py-2.5 font-medium text-gray-800">
                            {b.profiles
                              ? `${b.profiles.first_name} ${b.profiles.last_name}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">
                            {b.profiles?.email ?? "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${sourceBadgeClass(b.booking_source)}`}
                            >
                              {b.booking_source}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">
                            {b.payments[0]?.status ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">
                            {b.grade ?? "—"}
                          </td>
                        </tr>
                      ))}
                    {/* Rows from roster records */}
                    {session.roster_records.map((r) => (
                      <tr key={`roster-${r.id}`} className="hover:bg-gray-50">
                        <td className="px-6 py-2.5 font-medium text-gray-800">
                          {r.first_name} {r.last_name}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {r.email ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                            roster
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-400">—</td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {r.grade ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column: Tools + Invoices ── */}
        <div className="space-y-6">

          {/* ══ Section 4: Tools ══ */}
          {canUseTools && (
            <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
              <h2 className="text-base font-semibold text-gray-900">Tools</h2>

              {/* Grading tool */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    Grading Tool
                  </span>
                  <span className="text-xs text-gray-500">
                    {gradedCount} / {totalStudents} graded
                  </span>
                </div>
                {session.status === "completed" ? (
                  <Link
                    href={`/admin/sessions/${session.id}/grades`}
                    className="block text-center px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors"
                  >
                    Open Grading Tool
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="w-full text-center px-4 py-2 bg-gray-100 text-gray-400 text-sm font-semibold rounded-md cursor-not-allowed"
                    title="Available after session is marked completed"
                  >
                    Open Grading Tool
                  </button>
                )}
              </div>

              {/* Enrollware */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    Enrollware
                  </span>
                  {session.enrollware_submitted && (
                    <span className="text-xs font-medium text-green-600">
                      Submitted
                    </span>
                  )}
                </div>
                <a
                  href="https://www.enrollware.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors"
                >
                  Open Enrollware ↗
                </a>
              </div>

              {/* CSV Export — super admin only, completed sessions only */}
              {isSuperAdmin && (
                <div className="space-y-1">
                  <span className="text-sm font-medium text-gray-700">
                    Export Student Data
                  </span>
                  {session.status === "completed" ? (
                    <button
                      type="button"
                      onClick={handleExportCSV}
                      className="w-full text-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors"
                    >
                      Export CSV
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="w-full text-center px-4 py-2 bg-gray-100 text-gray-400 text-sm font-semibold rounded-md cursor-not-allowed"
                      title="Available after session is marked completed"
                    >
                      Export CSV
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══ Section 3: Invoices ══ */}
          {canSeeInvoices && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-900">
                  Invoices
                </h2>
                <Link
                  href={`/admin/invoices/new?session=${session.id}`}
                  className="text-sm font-medium text-red-600 hover:text-red-700"
                >
                  + Send Invoice
                </Link>
              </div>

              {session.invoices.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  No invoices yet.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {session.invoices.map((inv) => (
                    <li key={inv.id} className="px-5 py-3 hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/admin/invoices/${inv.id}`}
                            className="text-sm font-medium text-red-600 hover:underline"
                          >
                            {inv.invoice_number}
                          </Link>
                          <p className="text-xs text-gray-500 truncate">
                            {inv.company_name ?? inv.recipient_name} ·{" "}
                            {inv.student_count} student
                            {inv.student_count !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${invoiceStatusBadgeClass(inv.status)}`}
                          >
                            {inv.status}
                          </span>
                          <p className="text-xs text-gray-500 mt-0.5">
                            ${Number(inv.total_amount).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
