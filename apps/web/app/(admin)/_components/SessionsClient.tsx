"use client";

/**
 * SessionsClient — client-side filter and render for the admin sessions list.
 * Receives all sessions from the server component; handles filtering locally.
 * Used by: app/(admin)/admin/sessions/page.tsx
 */

import { useState, useMemo } from "react";
import Link from "next/link";
import type { SessionWithMeta, InstructorOption } from "../../../admin/sessions/page";
import type { SessionApprovalStatus, SessionStatus } from "@/types/schedule";
import type { UserRole } from "@/types/users";

interface SessionsClientProps {
  sessions: SessionWithMeta[];
  instructors: InstructorOption[];
  userRole: UserRole;
  /** The logged-in user's profile id — used to gate Grade button for instructors. */
  userId: string;
}

/** Approval status badge config. */
const APPROVAL_BADGES: Record<
  SessionApprovalStatus,
  { label: string; classes: string }
> = {
  pending_approval: {
    label: "Awaiting Approval",
    classes: "bg-amber-100 text-amber-700",
  },
  approved: { label: "Approved", classes: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", classes: "bg-red-100 text-red-700" },
};

/** Session status badge config. */
const STATUS_BADGES: Record<SessionStatus, { label: string; classes: string }> =
  {
    scheduled: { label: "Scheduled", classes: "bg-blue-100 text-blue-700" },
    in_progress: {
      label: "In Progress",
      classes: "bg-amber-100 text-amber-700",
    },
    completed: { label: "Completed", classes: "bg-green-100 text-green-700" },
    cancelled: { label: "Cancelled", classes: "bg-red-100 text-red-700" },
  };

/**
 * Formats a timestamptz string as a readable date + time, e.g. "Mon, Jun 12 · 9:00 AM – 11:00 AM".
 * @param startsAt - ISO start timestamp
 * @param endsAt - ISO end timestamp
 */
function formatSessionTime(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const date = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${startTime} – ${endTime}`;
}

/**
 * Groups an array of sessions by month label, e.g. "April 2026".
 * @param sessions - Filtered session array
 */
function groupByMonth(sessions: SessionWithMeta[]): [string, SessionWithMeta[]][] {
  const map = new Map<string, SessionWithMeta[]>();
  for (const session of sessions) {
    const key = new Date(session.starts_at).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(session);
  }
  return Array.from(map.entries());
}

/** Client component that renders filters and the sessions list. */
export default function SessionsClient({
  sessions,
  instructors,
  userRole,
  userId,
}: SessionsClientProps) {
  const today = new Date().toISOString().slice(0, 10);
  const isManager = userRole === "manager" || userRole === "super_admin";

  // ── Filter state ──────────────────────────────────────────────────────────
  const [showPastSessions, setShowPastSessions] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterClassType, setFilterClassType] = useState("");
  const [filterApproval, setFilterApproval] =
    useState<SessionApprovalStatus | "">("");
  const [filterInstructor, setFilterInstructor] = useState("");

  // Derive unique class type options from the sessions data
  const classTypeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of sessions) {
      if (s.class_types && !seen.has(s.class_types.id)) {
        seen.set(s.class_types.id, s.class_types.name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [sessions]);

  // ── Filtered sessions ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      const sessionDate = s.starts_at.slice(0, 10);

      if (!showPastSessions && sessionDate < today) return false;
      if (filterFrom && sessionDate < filterFrom) return false;
      if (filterTo && sessionDate > filterTo) return false;
      if (filterClassType && s.class_types?.id !== filterClassType) return false;
      if (filterApproval && s.approval_status !== filterApproval) return false;
      if (filterInstructor && s.instructor?.id !== filterInstructor) return false;

      return true;
    });
  }, [
    sessions,
    showPastSessions,
    today,
    filterFrom,
    filterTo,
    filterClassType,
    filterApproval,
    filterInstructor,
  ]);

  const grouped = groupByMonth(filtered);

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Class Sessions</h1>
        <Link
          href="/admin/sessions/new"
          className="inline-flex items-center px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors"
        >
          + Create New Class Session
        </Link>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Past sessions toggle */}
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showPastSessions}
              onChange={(e) => setShowPastSessions(e.target.checked)}
              className="rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            Show past sessions
          </label>

          {/* From date */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500" htmlFor="filter-from">
              From
            </label>
            <input
              id="filter-from"
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* To date */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-500" htmlFor="filter-to">
              To
            </label>
            <input
              id="filter-to"
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Class type */}
          <select
            value={filterClassType}
            onChange={(e) => setFilterClassType(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500"
            aria-label="Filter by class type"
          >
            <option value="">All class types</option>
            {classTypeOptions.map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.name}
              </option>
            ))}
          </select>

          {/* Approval status */}
          <select
            value={filterApproval}
            onChange={(e) =>
              setFilterApproval(e.target.value as SessionApprovalStatus | "")
            }
            className="text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500"
            aria-label="Filter by approval status"
          >
            <option value="">All statuses</option>
            <option value="pending_approval">Awaiting Approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>

          {/* Instructor filter — manager/super admin only */}
          {isManager && instructors.length > 0 && (
            <select
              value={filterInstructor}
              onChange={(e) => setFilterInstructor(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              aria-label="Filter by instructor"
            >
              <option value="">All instructors</option>
              {instructors.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.first_name} {inst.last_name}
                </option>
              ))}
            </select>
          )}

          {/* Clear filters */}
          {(filterFrom ||
            filterTo ||
            filterClassType ||
            filterApproval ||
            filterInstructor) && (
            <button
              type="button"
              onClick={() => {
                setFilterFrom("");
                setFilterTo("");
                setFilterClassType("");
                setFilterApproval("");
                setFilterInstructor("");
              }}
              className="text-xs text-red-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Sessions list ── */}
      {grouped.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          {sessions.length === 0 ? (
            <>
              <p className="text-gray-500 mb-4">
                No class sessions yet. Create your first class session to get started.
              </p>
              <Link
                href="/admin/sessions/new"
                className="inline-flex items-center px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors"
              >
                + Create New Class Session
              </Link>
            </>
          ) : (
            <p className="text-gray-500">
              No class sessions found. Try adjusting your filters.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([month, monthSessions]) => (
            <section key={month}>
              {/* Sticky month header */}
              <h2 className="sticky top-0 z-10 bg-gray-50 text-sm font-semibold text-gray-500 uppercase tracking-wide py-2 mb-3 border-b border-gray-200">
                {month}
              </h2>

              <div className="space-y-3">
                {monthSessions.map((session) => {
                  const approvalBadge =
                    APPROVAL_BADGES[session.approval_status];
                  const statusBadge = STATUS_BADGES[session.status];
                  const isRejected = session.approval_status === "rejected";
                  const isOwnSession = session.instructor?.id === userId;
                  const canGrade =
                    userRole === "super_admin" ||
                    (userRole === "instructor" && isOwnSession);

                  return (
                    <div
                      key={session.id}
                      className="bg-white border border-gray-200 rounded-lg p-5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        {/* ── Left: session info ── */}
                        <div className="space-y-1 min-w-0">
                          <h3 className="text-base font-semibold text-gray-900">
                            {session.class_types?.name ?? "Unknown Class"}
                          </h3>
                          <p className="text-sm text-gray-500">
                            {formatSessionTime(
                              session.starts_at,
                              session.ends_at
                            )}
                          </p>
                          <p className="text-sm text-gray-500">
                            {session.locations?.name ?? "—"}
                          </p>
                          {isManager && session.instructor && (
                            <p className="text-sm text-gray-500">
                              {session.instructor.first_name}{" "}
                              {session.instructor.last_name}
                            </p>
                          )}
                          <p className="text-sm text-gray-400">
                            {session.max_capacity - session.spotsRemaining}/
                            {session.max_capacity} students booked
                          </p>
                        </div>

                        {/* ── Right: badges + actions ── */}
                        <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
                          <div className="flex flex-wrap gap-2">
                            <span
                              className={[
                                "text-xs font-semibold px-2 py-0.5 rounded-full",
                                approvalBadge.classes,
                              ].join(" ")}
                            >
                              {approvalBadge.label}
                            </span>
                            <span
                              className={[
                                "text-xs font-semibold px-2 py-0.5 rounded-full",
                                statusBadge.classes,
                              ].join(" ")}
                            >
                              {statusBadge.label}
                            </span>
                          </div>

                          <div className="flex gap-2">
                            <Link
                              href={`/admin/sessions/${session.id}`}
                              className="text-sm font-medium text-red-600 hover:underline"
                            >
                              View
                            </Link>
                            {canGrade &&
                              session.status === "completed" && (
                                <Link
                                  href={`/admin/sessions/${session.id}/grades`}
                                  className="text-sm font-medium text-gray-600 hover:underline"
                                >
                                  Grade
                                </Link>
                              )}
                          </div>
                        </div>
                      </div>

                      {/* ── Rejection reason — instructor view only ── */}
                      {isRejected && session.rejection_reason && (
                        <div className="mt-3 pt-3 border-t border-red-100">
                          <p className="text-sm text-red-700">
                            <span className="font-medium">
                              Rejection reason:
                            </span>{" "}
                            {session.rejection_reason}
                          </p>
                          {userRole === "instructor" && (
                            <Link
                              href={`/admin/sessions/${session.id}`}
                              className="mt-1 inline-block text-sm text-red-600 hover:underline"
                            >
                              Please review and resubmit →
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
