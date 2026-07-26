"use client";

/**
 * ContactSubmissionsClient — client component for the admin contact submissions page.
 * Renders the filter bar, the grouped submission list (unanswered / replied),
 * per-submission expand/collapse accordion, Zoho email thread display,
 * reply form, call-status toggle, and per-submission staff notes.
 * Used by: app/(admin)/admin/contact/page.tsx
 */

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { CONTACT_INQUIRY_TYPES } from "@/lib/contact-constants";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Minimal reply metadata fetched with each submission row. */
interface ReplyMeta {
  id: string;
  created_at: string;
}

/**
 * A contact_submissions row as returned from the server query,
 * including nested contact_replies metadata.
 */
export interface SubmissionWithReplies {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  inquiry_type: string;
  message: string;
  replied: boolean;
  /** Whether a staff member has spoken to this customer by phone. */
  called: boolean;
  /** Free-form internal staff notes about the conversation. */
  notes: string | null;
  created_at: string;
  contact_replies: ReplyMeta[];
}

/** URL filter params passed from the server. */
export interface ContactFilters {
  type?: string;
  replied?: string;
  from?: string;
  to?: string;
}

/** A single message in the Zoho email thread. */
interface ThreadMessage {
  id: string;
  subject: string;
  body: string;
  from: string;
  date: string;
  isInbound: boolean;
}

interface SubmissionsClientProps {
  initialSubmissions: SubmissionWithReplies[];
  filters: ContactFilters;
  isZohoConnected: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Returns a relative time string (e.g. "2 days ago") for the given ISO timestamp.
 * @param iso - ISO datetime string.
 */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days !== 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? "s" : ""} ago`;
}

/**
 * Formats a full date string for the title tooltip on relative timestamps.
 * @param iso - ISO datetime string.
 */
function fullDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Returns the Tailwind badge classes for a given inquiry type.
 * @param type - inquiry_type string from the database.
 */
function typeBadgeClass(type: string): string {
  switch (type) {
    case "Group Booking (5+ people)":
      return "bg-blue-100 text-blue-700";
    case "Corporate / Workplace Training":
      return "bg-purple-100 text-purple-700";
    case "Certification Renewal":
      return "bg-green-100 text-green-700";
    case "Booking Inquiry":
      return "bg-orange-100 text-orange-700";
    case "General Question":
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

/** Matches YYYY-MM-DD — used to validate date filter inputs before navigating. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Main component ─────────────────────────────────────────────────────────────

/** Client component for the contact submissions page. */
export default function ContactSubmissionsClient({
  initialSubmissions,
  filters,
  isZohoConnected,
}: SubmissionsClientProps) {
  const router = useRouter();

  // ── Local state for date inputs (controlled, navigate on blur) ─────────────
  const [fromFilter, setFromFilter] = useState(filters.from ?? "");
  const [toFilter, setToFilter] = useState(filters.to ?? "");

  // Sync date inputs when the server re-renders with updated filter props.
  useEffect(() => {
    setFromFilter(filters.from ?? "");
    setToFilter(filters.to ?? "");
  }, [filters.from, filters.to]);

  // ── Client-side text search ────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");

  // ── Accordion state ────────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Detail tab (conversation vs notes) ────────────────────────────────────
  const [detailTab, setDetailTab] = useState<"conversation" | "notes">("conversation");

  // ── Thread state ──────────────────────────────────────────────────────────
  const [threads, setThreads] = useState<Record<string, ThreadMessage[]>>({});
  const [threadLoading, setThreadLoading] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);

  // ── Reply form state ──────────────────────────────────────────────────────
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [replySending, setReplySending] = useState(false);
  const [replySuccess, setReplySuccess] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  // ── Local submission list (updated optimistically after actions) ───────────
  const [submissions, setSubmissions] = useState<SubmissionWithReplies[]>(initialSubmissions);

  useEffect(() => {
    setSubmissions(initialSubmissions);
  }, [initialSubmissions]);

  // ── Inline mark-as-replied ─────────────────────────────────────────────────
  const [markingReplied, setMarkingReplied] = useState<Set<string>>(new Set());

  // ── Called toggle ─────────────────────────────────────────────────────────
  const [callingToggle, setCallingToggle] = useState<Set<string>>(new Set());

  // ── Notes per submission ──────────────────────────────────────────────────
  // Keyed by submission id — stores the live textarea value before/after save.
  const [notesText, setNotesText] = useState<Map<string, string>>(new Map());
  const [notesSaveState, setNotesSaveState] = useState<Map<string, "saving" | "saved">>(
    new Map()
  );

  // ── Filter bar collapse ────────────────────────────────────────────────────
  const hasActiveFilters = !!filters.type || !!filters.replied || !!filters.from || !!filters.to;
  // Only count the collapsible filters (type, dates) in the badge — replied is shown via pills
  const collapsibleFilterCount = [filters.type, filters.from, filters.to].filter(Boolean).length;
  // Start open if any collapsible filters are active so users aren't confused by a filtered list
  const [filtersOpen, setFiltersOpen] = useState(collapsibleFilterCount > 0);

  // ── Draft persistence ──────────────────────────────────────────────────────
  // Persist the reply draft to localStorage so it survives switching submissions.
  useEffect(() => {
    if (!expandedId) return;
    try {
      if (replyBody.trim() || replySubject.trim()) {
        localStorage.setItem(
          `contact-draft-${expandedId}`,
          JSON.stringify({ subject: replySubject, body: replyBody })
        );
      }
    } catch {
      // localStorage unavailable — degrade silently
    }
  }, [expandedId, replySubject, replyBody]);

  // ── URL helpers ────────────────────────────────────────────────────────────

  /**
   * Builds the URL with updated filter query params, omitting empty values.
   * @param overrides - Partial filter values to merge over the current URL filters.
   */
  function buildUrl(overrides: Partial<ContactFilters> = {}): string {
    const merged: ContactFilters = { ...filters, ...overrides };
    const params = new URLSearchParams();
    if (merged.type) params.set("type", merged.type);
    if (merged.replied) params.set("replied", merged.replied);
    if (merged.from) params.set("from", merged.from);
    if (merged.to) params.set("to", merged.to);
    const qs = params.toString();
    return `/admin/contact${qs ? `?${qs}` : ""}`;
  }

  // ── Status pill navigation ─────────────────────────────────────────────────

  /**
   * Navigates to the URL with the replied filter toggled.
   * @param value - "all" clears the filter; "false" = unanswered; "true" = replied.
   */
  function setRepliedFilter(value: "all" | "false" | "true"): void {
    router.push(buildUrl({ replied: value === "all" ? undefined : value }));
  }

  // ── Accordion expand/collapse ──────────────────────────────────────────────

  /**
   * Toggles the expand state for a submission. When expanding, restores any
   * saved draft from localStorage, loads the Zoho thread if not yet fetched,
   * resets the detail tab, and initialises the notes textarea from saved notes.
   * @param sub - The submission being toggled.
   */
  const handleToggle = useCallback(
    async (sub: SubmissionWithReplies) => {
      if (expandedId === sub.id) {
        setExpandedId(null);
        return;
      }

      setExpandedId(sub.id);
      setDetailTab("conversation");

      // Initialise notes text from the saved value (only on first open — preserves unsaved edits)
      setNotesText((prev) => {
        if (prev.has(sub.id)) return prev;
        const next = new Map(prev);
        next.set(sub.id, sub.notes ?? "");
        return next;
      });

      // Restore saved draft if one exists, otherwise populate default subject
      let savedSubject = `Re: ${sub.inquiry_type} inquiry from ${sub.name}`;
      let savedBody = "";
      try {
        const raw = localStorage.getItem(`contact-draft-${sub.id}`);
        if (raw) {
          const draft = JSON.parse(raw) as { subject?: string; body?: string };
          if (draft.subject) savedSubject = draft.subject;
          if (draft.body) savedBody = draft.body;
        }
      } catch {
        // ignore — fall back to defaults
      }

      setReplySubject(savedSubject);
      setReplyBody(savedBody);
      setReplyFiles([]);
      setReplySuccess(false);
      setReplyError(null);

      if (isZohoConnected && !threads[sub.id]) {
        setThreadLoading(sub.id);
        setThreadError(null);
        try {
          const res = await fetch(
            `/api/contact/thread?email=${encodeURIComponent(sub.email)}`
          );
          const json = (await res.json()) as {
            success: boolean;
            messages?: ThreadMessage[];
            error?: string;
          };
          if (json.success && json.messages) {
            setThreads((prev) => ({ ...prev, [sub.id]: json.messages! }));
          } else {
            setThreadError(json.error ?? "Failed to load thread.");
          }
        } catch {
          setThreadError("Network error loading thread.");
        } finally {
          setThreadLoading(null);
        }
      }
    },
    [expandedId, isZohoConnected, threads]
  );

  // ── Inline mark-as-replied ─────────────────────────────────────────────────

  /**
   * Marks a submission as replied without sending an email — for cases where
   * the conversation happened by phone or another channel.
   * @param submissionId - ID of the submission to mark.
   */
  async function handleMarkReplied(submissionId: string): Promise<void> {
    setMarkingReplied((prev) => new Set(prev).add(submissionId));
    try {
      const res = await fetch(`/api/contact/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replied" }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) {
        setSubmissions((prev) =>
          prev.map((s) => (s.id === submissionId ? { ...s, replied: true } : s))
        );
      }
    } catch {
      // Non-fatal — row stays in unanswered, user can retry
    } finally {
      setMarkingReplied((prev) => {
        const next = new Set(prev);
        next.delete(submissionId);
        return next;
      });
    }
  }

  // ── Called toggle ─────────────────────────────────────────────────────────

  /**
   * Toggles the called flag on a submission — optimistically updates the UI
   * and rolls back if the server returns an error.
   * @param submissionId - ID of the submission to toggle.
   */
  async function handleToggleCalled(submissionId: string): Promise<void> {
    const sub = submissions.find((s) => s.id === submissionId);
    if (!sub) return;
    const newCalled = !sub.called;

    // Optimistic update
    setSubmissions((prev) =>
      prev.map((s) => (s.id === submissionId ? { ...s, called: newCalled } : s))
    );
    setCallingToggle((prev) => new Set(prev).add(submissionId));

    try {
      const res = await fetch(`/api/contact/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "called", called: newCalled }),
      });
      const json = (await res.json()) as { success: boolean };
      if (!json.success) {
        // Roll back
        setSubmissions((prev) =>
          prev.map((s) => (s.id === submissionId ? { ...s, called: !newCalled } : s))
        );
      }
    } catch {
      // Roll back on network error
      setSubmissions((prev) =>
        prev.map((s) => (s.id === submissionId ? { ...s, called: !newCalled } : s))
      );
    } finally {
      setCallingToggle((prev) => {
        const next = new Set(prev);
        next.delete(submissionId);
        return next;
      });
    }
  }

  // ── Notes save ─────────────────────────────────────────────────────────────

  /**
   * Saves the current notes text for a submission (triggered on textarea blur).
   * @param submissionId - ID of the submission whose notes to save.
   */
  async function handleSaveNotes(submissionId: string): Promise<void> {
    const notes = notesText.get(submissionId) ?? "";
    setNotesSaveState((prev) => new Map(prev).set(submissionId, "saving"));
    try {
      const res = await fetch(`/api/contact/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "notes", notes }),
      });
      const json = (await res.json()) as { success: boolean };
      if (json.success) {
        setSubmissions((prev) =>
          prev.map((s) => (s.id === submissionId ? { ...s, notes } : s))
        );
        setNotesSaveState((prev) => new Map(prev).set(submissionId, "saved"));
        setTimeout(() => {
          setNotesSaveState((prev) => {
            const next = new Map(prev);
            next.delete(submissionId);
            return next;
          });
        }, 3000);
      } else {
        setNotesSaveState((prev) => {
          const next = new Map(prev);
          next.delete(submissionId);
          return next;
        });
      }
    } catch {
      setNotesSaveState((prev) => {
        const next = new Map(prev);
        next.delete(submissionId);
        return next;
      });
    }
  }

  // ── Reply send ─────────────────────────────────────────────────────────────

  /**
   * Sends the reply email via Zoho (POST /api/contact/reply) with any selected
   * attachments. Updates the local submission list and clears the saved draft on success.
   * @param submissionId - The ID of the submission being replied to.
   */
  async function handleSendReply(submissionId: string): Promise<void> {
    if (!replySubject.trim() || !replyBody.trim()) return;

    setReplySending(true);
    setReplyError(null);

    try {
      const form = new FormData();
      form.append("submissionId", submissionId);
      form.append("subject", replySubject.trim());
      form.append("body", replyBody.trim());
      for (const file of replyFiles) {
        form.append("files", file);
      }

      const res = await fetch("/api/contact/reply", { method: "POST", body: form });
      const json = (await res.json()) as { success: boolean; error?: string };

      if (!json.success) {
        setReplyError(json.error ?? "Failed to send reply.");
        return;
      }

      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submissionId
            ? {
                ...s,
                replied: true,
                contact_replies: [
                  ...s.contact_replies,
                  { id: crypto.randomUUID(), created_at: new Date().toISOString() },
                ],
              }
            : s
        )
      );

      // Clear the saved draft on successful send
      try { localStorage.removeItem(`contact-draft-${submissionId}`); } catch {}

      // Reload the thread to show the new outbound message
      if (isZohoConnected) {
        const sub = submissions.find((s) => s.id === submissionId);
        if (sub) {
          const res2 = await fetch(
            `/api/contact/thread?email=${encodeURIComponent(sub.email)}`
          );
          const json2 = (await res2.json()) as {
            success: boolean;
            messages?: ThreadMessage[];
          };
          if (json2.success && json2.messages) {
            setThreads((prev) => ({ ...prev, [submissionId]: json2.messages! }));
          }
        }
      }

      setReplySuccess(true);
      setReplyBody("");
      setReplyFiles([]);
      setTimeout(() => setReplySuccess(false), 5000);
    } catch {
      setReplyError("Network error. Please try again.");
    } finally {
      setReplySending(false);
    }
  }

  // ── Client-side search filtering ────────────────────────────────────────────
  const displayedSubmissions = searchQuery.trim()
    ? submissions.filter((s) => {
        const q = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          (s.phone ?? "").toLowerCase().includes(q) ||
          s.message.toLowerCase().includes(q)
        );
      })
    : submissions;

  const unanswered = displayedSubmissions.filter((s) => !s.replied);
  const replied = displayedSubmissions.filter((s) => s.replied);

  // ── Pill button helper ────────────────────────────────────────────────────

  function pillClass(active: boolean): string {
    return active
      ? "rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white"
      : "rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-600 ring-1 ring-inset ring-gray-300 hover:bg-gray-50";
  }

  // ── Shared SubmissionRow prop builder ─────────────────────────────────────

  function rowProps(sub: SubmissionWithReplies, onMarkReplied: (() => void) | undefined) {
    return {
      sub,
      isExpanded: expandedId === sub.id,
      thread: threads[sub.id],
      threadLoading: threadLoading === sub.id,
      threadError: expandedId === sub.id ? threadError : null,
      isZohoConnected,
      replySubject: expandedId === sub.id ? replySubject : "",
      replyBody: expandedId === sub.id ? replyBody : "",
      replyFiles: expandedId === sub.id ? replyFiles : [],
      replySending: expandedId === sub.id && replySending,
      replySuccess: expandedId === sub.id && replySuccess,
      replyError: expandedId === sub.id ? replyError : null,
      markingReplied: markingReplied.has(sub.id),
      callingToggle: callingToggle.has(sub.id),
      notesText: notesText.get(sub.id) ?? sub.notes ?? "",
      notesSaveState: notesSaveState.get(sub.id),
      detailTab: expandedId === sub.id ? detailTab : "conversation" as const,
      onToggle: () => handleToggle(sub),
      onSubjectChange: setReplySubject,
      onBodyChange: setReplyBody,
      onFilesChange: setReplyFiles,
      onSend: () => handleSendReply(sub.id),
      onMarkReplied,
      onToggleCalled: () => handleToggleCalled(sub.id),
      onNotesChange: (v: string) =>
        setNotesText((prev) => new Map(prev).set(sub.id, v)),
      onNotesSave: () => handleSaveNotes(sub.id),
      onDetailTabChange: setDetailTab,
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Zoho not connected — setup prompt */}
      {!isZohoConnected && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <Mail className="h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            Zoho Mail is not connected. Email threads and reply sending are unavailable.{" "}
            <Link
              href="/admin/settings"
              className="font-semibold underline hover:text-amber-900"
            >
              Connect Zoho in Settings
            </Link>
          </p>
        </div>
      )}

      {/* ── Search bar ──────────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          placeholder="Search by name, email, phone, or message…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-4 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white">
        {/* Always-visible row: status pills + filter toggle */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500">Status:</span>
            <button
              type="button"
              onClick={() => setRepliedFilter("all")}
              className={pillClass(!filters.replied)}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setRepliedFilter("false")}
              className={pillClass(filters.replied === "false")}
            >
              Unanswered
            </button>
            <button
              type="button"
              onClick={() => setRepliedFilter("true")}
              className={pillClass(filters.replied === "true")}
            >
              Replied
            </button>
          </div>

          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {collapsibleFilterCount > 0 && (
              <span className="rounded-full bg-red-600 px-1.5 text-xs font-semibold leading-5 text-white">
                {collapsibleFilterCount}
              </span>
            )}
            {filtersOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {hasActiveFilters && (
            <Link
              href="/admin/contact"
              onClick={() => {
                setFromFilter("");
                setToFilter("");
              }}
              className="whitespace-nowrap text-xs text-red-600 hover:underline"
            >
              Clear all
            </Link>
          )}
        </div>

        {/* Collapsible filter controls — type and date range */}
        {filtersOpen && (
          <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 px-4 py-3">
            {/* Inquiry type — auto-navigates on change, no Apply button needed */}
            <div className="flex items-center gap-2">
              <label htmlFor="typeFilter" className="text-xs font-medium text-gray-500">
                Type:
              </label>
              <select
                id="typeFilter"
                value={filters.type ?? ""}
                onChange={(e) =>
                  router.push(buildUrl({ type: e.target.value || undefined }))
                }
                className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              >
                <option value="">All</option>
                {CONTACT_INQUIRY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Date range — controlled locally, navigates on blur */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="fromFilter" className="text-xs font-medium text-gray-500">
                From:
              </label>
              <input
                id="fromFilter"
                type="date"
                value={fromFilter}
                onChange={(e) => setFromFilter(e.target.value)}
                onBlur={(e) => {
                  const val = e.target.value;
                  if (!val || DATE_RE.test(val)) {
                    router.push(buildUrl({ from: val || undefined }));
                  }
                }}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label htmlFor="toFilter" className="text-xs font-medium text-gray-500">
                To:
              </label>
              <input
                id="toFilter"
                type="date"
                value={toFilter}
                onChange={(e) => setToFilter(e.target.value)}
                onBlur={(e) => {
                  const val = e.target.value;
                  if (!val || DATE_RE.test(val)) {
                    router.push(buildUrl({ to: val || undefined }));
                  }
                }}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Submissions list ─────────────────────────────────────────────────── */}
      {displayedSubmissions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-16 text-center">
          <Mail className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-500">
            {searchQuery.trim()
              ? `No submissions match "${searchQuery}".`
              : hasActiveFilters
              ? "No submissions match your filters."
              : "No contact submissions yet."}
          </p>
          {(hasActiveFilters || searchQuery.trim()) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                if (hasActiveFilters) router.push("/admin/contact");
              }}
              className="mt-2 text-sm text-red-600 hover:underline"
            >
              Clear{" "}
              {searchQuery.trim() && hasActiveFilters
                ? "search and filters"
                : searchQuery.trim()
                ? "search"
                : "filters"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Unanswered section ──────────────────────────────────────────── */}
          {unanswered.length > 0 && (
            <section aria-label="Unanswered submissions">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
                Unanswered ({unanswered.length})
              </p>
              <div className="space-y-2">
                {unanswered.map((sub) => (
                  <SubmissionRow
                    key={sub.id}
                    accentClass="border-l-4 border-l-amber-400"
                    {...rowProps(sub, () => handleMarkReplied(sub.id))}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Replied section ──────────────────────────────────────────────── */}
          {replied.length > 0 && (
            <section aria-label="Replied submissions">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-600">
                Replied ({replied.length})
              </p>
              <div className="space-y-2">
                {replied.map((sub) => (
                  <SubmissionRow
                    key={sub.id}
                    accentClass="border-l-4 border-l-green-400"
                    {...rowProps(sub, undefined)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ── SubmissionRow sub-component ────────────────────────────────────────────────

interface SubmissionRowProps {
  sub: SubmissionWithReplies;
  isExpanded: boolean;
  accentClass: string;
  thread: ThreadMessage[] | undefined;
  threadLoading: boolean;
  threadError: string | null;
  isZohoConnected: boolean;
  replySubject: string;
  replyBody: string;
  replyFiles: File[];
  replySending: boolean;
  replySuccess: boolean;
  replyError: string | null;
  /** Whether this row's inline "mark replied" action is in flight. */
  markingReplied: boolean;
  /** Whether this row's called toggle is in flight. */
  callingToggle: boolean;
  /** Current notes textarea value (may be unsaved). */
  notesText: string;
  /** Save state for the notes textarea. */
  notesSaveState: "saving" | "saved" | undefined;
  /** Active tab in the expanded detail panel. */
  detailTab: "conversation" | "notes";
  onToggle: () => void;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onFilesChange: (files: File[]) => void;
  onSend: () => void;
  /** Undefined on already-replied rows — hides the button. */
  onMarkReplied: (() => void) | undefined;
  onToggleCalled: () => void;
  onNotesChange: (v: string) => void;
  onNotesSave: () => void;
  onDetailTabChange: (tab: "conversation" | "notes") => void;
}

/**
 * A single submission accordion row. Shows a summary line when collapsed and
 * the full message + thread + reply form when expanded.
 * When the submission has been called, a phone badge appears on the summary row.
 */
function SubmissionRow({
  sub,
  isExpanded,
  accentClass,
  thread,
  threadLoading,
  threadError,
  isZohoConnected,
  replySubject,
  replyBody,
  replyFiles,
  replySending,
  replySuccess,
  replyError,
  markingReplied,
  callingToggle,
  notesText,
  notesSaveState,
  detailTab,
  onToggle,
  onSubjectChange,
  onBodyChange,
  onFilesChange,
  onSend,
  onMarkReplied,
  onToggleCalled,
  onNotesChange,
  onNotesSave,
  onDetailTabChange,
}: SubmissionRowProps) {
  return (
    <div className={`${accentClass} ${sub.called ? "bg-blue-50/30" : "bg-white"} rounded-lg border border-gray-200 overflow-hidden`}>
      {/* Summary row — always visible */}
      <div className="flex w-full items-start gap-3 px-4 py-3">
        {/* Clickable expand area */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex flex-1 min-w-0 items-start gap-3 text-left focus:outline-none"
        >
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900">{sub.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${typeBadgeClass(sub.inquiry_type)}`}
              >
                {sub.inquiry_type}
              </span>
              {/* Called badge — visible at a glance when a phone conversation has happened */}
              {sub.called && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                  <Phone className="h-3 w-3" />
                  Called
                </span>
              )}
              {sub.contact_replies.length > 0 && (
                <span className="text-xs text-gray-400">
                  {sub.contact_replies.length}{" "}
                  {sub.contact_replies.length === 1 ? "reply" : "replies"}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <a
                href={`mailto:${sub.email}`}
                className="hover:text-red-600 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {sub.email}
              </a>
              {sub.phone && (
                <a
                  href={`tel:${sub.phone}`}
                  className="hover:text-red-600 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {sub.phone}
                </a>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-600 line-clamp-1">
              {sub.message.slice(0, 120)}
              {sub.message.length > 120 ? "..." : ""}
            </p>
          </div>
        </button>

        {/* Right-side actions: called toggle + mark replied + timestamp + chevron */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Called toggle — blue when active */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCalled();
            }}
            disabled={callingToggle}
            title={sub.called ? "Mark as not called" : "Mark as called"}
            className={`rounded p-1 transition-colors disabled:opacity-50 ${
              sub.called
                ? "text-blue-600 hover:bg-blue-100"
                : "text-gray-400 hover:bg-blue-50 hover:text-blue-600"
            }`}
          >
            {callingToggle ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Phone className="h-4 w-4" />
            )}
          </button>

          {onMarkReplied && (
            <button
              type="button"
              onClick={onMarkReplied}
              disabled={markingReplied}
              title="Mark as replied"
              className="rounded p-1 text-gray-400 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50"
            >
              {markingReplied ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            className="flex flex-col items-end gap-1 focus:outline-none"
          >
            <span title={fullDate(sub.created_at)} className="text-xs text-gray-400">
              {relativeTime(sub.created_at)}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded detail panel */}
      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50">
          {/* Tab bar */}
          <div className="flex border-b border-gray-200 px-4">
            {(["conversation", "notes"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => onDetailTabChange(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  detailTab === tab
                    ? "border-red-600 text-red-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab === "conversation" ? "Conversation" : "Notes"}
              </button>
            ))}
          </div>

          <div className="px-4 py-5 space-y-6">
            {/* ── Conversation tab ────────────────────────────────────────── */}
            {detailTab === "conversation" && (
              <>
                {/* Original message */}
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-gray-700">Original Message</h3>
                  <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-800 whitespace-pre-wrap">
                    {sub.message}
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400">
                    Received {fullDate(sub.created_at)}
                  </p>
                </section>

                {/* Zoho email thread */}
                {isZohoConnected && (
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-gray-700">Email Thread</h3>

                    {threadLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Loading conversation...
                      </div>
                    ) : threadError ? (
                      <p className="text-sm text-red-600">{threadError}</p>
                    ) : !thread || thread.length === 0 ? (
                      <p className="text-sm text-gray-400">No previous emails with this contact.</p>
                    ) : (
                      <div className="space-y-3">
                        {thread.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.isInbound ? "justify-start" : "justify-end"}`}
                          >
                            <div
                              className={`max-w-[85%] rounded-lg px-4 py-3 text-sm ${
                                msg.isInbound
                                  ? "border border-gray-200 bg-white text-gray-800"
                                  : "bg-gray-200 text-gray-900"
                              }`}
                            >
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-xs">{msg.from}</span>
                                <span className="text-xs text-gray-400">{fullDate(msg.date)}</span>
                              </div>
                              <p className="whitespace-pre-wrap">{msg.body}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {/* Reply form */}
                <section>
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">Send Reply</h3>

                  {!isZohoConnected ? (
                    <p className="text-sm text-gray-500">
                      Connect Zoho Mail in{" "}
                      <Link href="/admin/settings" className="text-red-600 underline hover:text-red-700">
                        Settings
                      </Link>{" "}
                      to send replies.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {/* Subject */}
                      <div>
                        <label
                          htmlFor={`subject-${sub.id}`}
                          className="mb-1 block text-xs font-medium text-gray-600"
                        >
                          Subject
                        </label>
                        <input
                          id={`subject-${sub.id}`}
                          type="text"
                          value={replySubject}
                          onChange={(e) => onSubjectChange(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                        />
                      </div>

                      {/* Body */}
                      <div>
                        <label
                          htmlFor={`body-${sub.id}`}
                          className="mb-1 block text-xs font-medium text-gray-600"
                        >
                          Message <span className="text-red-600">*</span>
                        </label>
                        <textarea
                          id={`body-${sub.id}`}
                          rows={6}
                          value={replyBody}
                          onChange={(e) => onBodyChange(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                          placeholder="Type your reply here…"
                        />
                      </div>

                      {/* Attachments */}
                      <div>
                        <label
                          htmlFor={`files-${sub.id}`}
                          className="mb-1 block text-xs font-medium text-gray-600"
                        >
                          Attachments{" "}
                          <span className="font-normal text-gray-400">
                            (PDF, DOC, DOCX, JPG, PNG — max 10 MB each)
                          </span>
                        </label>
                        <input
                          id={`files-${sub.id}`}
                          type="file"
                          multiple
                          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                          onChange={(e) => onFilesChange(Array.from(e.target.files ?? []))}
                          className="block w-full text-xs text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-gray-700 hover:file:bg-gray-200"
                        />
                        {replyFiles.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5">
                            {replyFiles.map((f, i) => (
                              <li key={i} className="flex items-center gap-1.5 text-xs text-gray-500">
                                <span>{f.name}</span>
                                <button
                                  type="button"
                                  onClick={() => onFilesChange(replyFiles.filter((_, idx) => idx !== i))}
                                  className="text-gray-400 hover:text-red-600"
                                  aria-label={`Remove ${f.name}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Feedback */}
                      {replySuccess && (
                        <p className="text-sm font-semibold text-green-600">Reply sent successfully.</p>
                      )}
                      {replyError && <p className="text-sm text-red-600">{replyError}</p>}

                      {/* Send button */}
                      <button
                        type="button"
                        onClick={onSend}
                        disabled={replySending || !replySubject.trim() || !replyBody.trim()}
                        className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {replySending ? (
                          <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            Sending…
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4" />
                            Send Reply
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </section>
              </>
            )}

            {/* ── Notes tab ──────────────────────────────────────────────── */}
            {detailTab === "notes" && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">Staff Notes</h3>
                  <span className="text-xs text-gray-400">
                    {notesSaveState === "saving" && (
                      <span className="flex items-center gap-1">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        Saving…
                      </span>
                    )}
                    {notesSaveState === "saved" && (
                      <span className="text-green-600">Saved</span>
                    )}
                    {!notesSaveState && "Auto-saves"}
                  </span>
                </div>
                <textarea
                  rows={8}
                  value={notesText}
                  onChange={(e) => onNotesChange(e.target.value)}
                  onBlur={onNotesSave}
                  placeholder="Add internal notes about this conversation — not visible to the customer…"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 bg-white"
                />
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
