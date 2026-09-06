"use client";

/**
 * ContactSubmissionsClient: client component for the admin contact submissions page.
 * Renders the filter bar, the grouped submission list (unanswered / replied),
 * per-submission expand/collapse accordion, Zoho email thread display,
 * reply form, call-status toggle, and a timestamped staff notes log.
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
import type { ContactNote } from "@/app/api/contact/[id]/notes/route";

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

/** Matches YYYY-MM-DD: used to validate date filter inputs before navigating. */
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

  // Re-sync the inputs when navigation changes the URL filters. Adjusting during
  // render rather than in an effect lets React re-render with the new values
  // before painting, instead of showing the stale ones for a frame.
  const [syncedFilters, setSyncedFilters] = useState(filters);
  if (
    syncedFilters.from !== filters.from ||
    syncedFilters.to !== filters.to
  ) {
    setSyncedFilters(filters);
    setFromFilter(filters.from ?? "");
    setToFilter(filters.to ?? "");
  }

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

  // A fresh list from the server supersedes any optimistic local edits. Adjusted
  // during render for the same reason as the filter inputs above.
  const [syncedSubmissions, setSyncedSubmissions] = useState(initialSubmissions);
  if (syncedSubmissions !== initialSubmissions) {
    setSyncedSubmissions(initialSubmissions);
    setSubmissions(initialSubmissions);
  }

  // ── Inline mark-as-replied ─────────────────────────────────────────────────
  const [markingReplied, setMarkingReplied] = useState<Set<string>>(new Set());

  // ── Called toggle ─────────────────────────────────────────────────────────
  const [callingToggle, setCallingToggle] = useState<Set<string>>(new Set());

  // ── Notes log ────────────────────────────────────────────────────────────
  const [notes, setNotes] = useState<Record<string, ContactNote[]>>({});
  const [notesLoading, setNotesLoading] = useState<string | null>(null);
  const [notesLoaded, setNotesLoaded] = useState<Set<string>>(new Set());
  const [addingNote, setAddingNote] = useState<Set<string>>(new Set());

  // ── Filter bar collapse ────────────────────────────────────────────────────
  const hasActiveFilters = !!filters.type || !!filters.replied || !!filters.from || !!filters.to;
  const collapsibleFilterCount = [filters.type, filters.from, filters.to].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(collapsibleFilterCount > 0);

  // ── Draft persistence ──────────────────────────────────────────────────────
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
      // localStorage unavailable: degrade silently
    }
  }, [expandedId, replySubject, replyBody]);

  // ── URL helpers ────────────────────────────────────────────────────────────

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

  function setRepliedFilter(value: "all" | "false" | "true"): void {
    router.push(buildUrl({ replied: value === "all" ? undefined : value }));
  }

  // ── Notes loading ─────────────────────────────────────────────────────────

  /**
   * Lazily fetches notes for a submission on first Notes tab open.
   * @param submissionId - ID of the submission whose notes to fetch.
   */
  const handleLoadNotes = useCallback(async (submissionId: string): Promise<void> => {
    if (notesLoaded.has(submissionId)) return;
    setNotesLoading(submissionId);
    try {
      const res = await fetch(`/api/contact/${submissionId}/notes`);
      const json = (await res.json()) as { success: boolean; notes?: ContactNote[] };
      if (json.success && json.notes) {
        setNotes((prev) => ({ ...prev, [submissionId]: json.notes! }));
        setNotesLoaded((prev) => new Set(prev).add(submissionId));
      }
    } catch {
      // Non-fatal: user can retry by switching tabs
    } finally {
      setNotesLoading(null);
    }
  }, [notesLoaded]);

  // ── Detail tab change ──────────────────────────────────────────────────────

  /**
   * Switches the detail tab. Triggers a notes load on first switch to "notes".
   * @param tab - The tab to switch to.
   */
  function handleDetailTabChange(tab: "conversation" | "notes"): void {
    setDetailTab(tab);
    if (tab === "notes" && expandedId) {
      handleLoadNotes(expandedId);
    }
  }

  // ── Add note ──────────────────────────────────────────────────────────────

  /**
   * Posts a new note and prepends it to the local notes list on success.
   * @param submissionId - Submission to attach the note to.
   * @param body         - Note text.
   * @returns true on success so the caller can clear its textarea.
   */
  async function handleAddNote(submissionId: string, body: string): Promise<boolean> {
    setAddingNote((prev) => new Set(prev).add(submissionId));
    try {
      const res = await fetch(`/api/contact/${submissionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = (await res.json()) as { success: boolean; note?: ContactNote };
      if (json.success && json.note) {
        setNotes((prev) => ({
          ...prev,
          [submissionId]: [json.note!, ...(prev[submissionId] ?? [])],
        }));
        setNotesLoaded((prev) => new Set(prev).add(submissionId));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setAddingNote((prev) => {
        const next = new Set(prev);
        next.delete(submissionId);
        return next;
      });
    }
  }

  // ── Accordion expand/collapse ──────────────────────────────────────────────

  const handleToggle = useCallback(
    async (sub: SubmissionWithReplies) => {
      if (expandedId === sub.id) {
        setExpandedId(null);
        return;
      }

      setExpandedId(sub.id);
      setDetailTab("conversation");

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
        // ignore
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

  // ── Mark as replied ────────────────────────────────────────────────────────

  async function handleMarkReplied(submissionId: string): Promise<void> {
    setMarkingReplied((prev) => new Set(prev).add(submissionId));
    try {
      const res = await fetch(`/api/contact/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replied" }),
      });
      const json = (await res.json()) as { success: boolean };
      if (json.success) {
        setSubmissions((prev) =>
          prev.map((s) => (s.id === submissionId ? { ...s, replied: true } : s))
        );
      }
    } catch {
      // Non-fatal
    } finally {
      setMarkingReplied((prev) => {
        const next = new Set(prev);
        next.delete(submissionId);
        return next;
      });
    }
  }

  // ── Called toggle ─────────────────────────────────────────────────────────

  async function handleToggleCalled(submissionId: string): Promise<void> {
    const sub = submissions.find((s) => s.id === submissionId);
    if (!sub) return;
    const newCalled = !sub.called;

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
        setSubmissions((prev) =>
          prev.map((s) => (s.id === submissionId ? { ...s, called: !newCalled } : s))
        );
      }
    } catch {
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

  // ── Reply send ─────────────────────────────────────────────────────────────

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

      try { localStorage.removeItem(`contact-draft-${submissionId}`); } catch {}

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

  function pillClass(active: boolean): string {
    return active
      ? "rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white"
      : "rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-600 ring-1 ring-inset ring-gray-300 hover:bg-gray-50";
  }

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
      submissionNotes: notes[sub.id],
      notesLoading: notesLoading === sub.id,
      addingNote: addingNote.has(sub.id),
      detailTab: expandedId === sub.id ? detailTab : "conversation" as const,
      onToggle: () => handleToggle(sub),
      onSubjectChange: setReplySubject,
      onBodyChange: setReplyBody,
      onFilesChange: setReplyFiles,
      onSend: () => handleSendReply(sub.id),
      onMarkReplied,
      onToggleCalled: () => handleToggleCalled(sub.id),
      onAddNote: (body: string) => handleAddNote(sub.id, body),
      onDetailTabChange: handleDetailTabChange,
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {!isZohoConnected && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <Mail className="h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            Zoho Mail is not connected. Email threads and reply sending are unavailable.{" "}
            <Link href="/admin/settings" className="font-semibold underline hover:text-amber-900">
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
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500">Status:</span>
            <button type="button" onClick={() => setRepliedFilter("all")} className={pillClass(!filters.replied)}>All</button>
            <button type="button" onClick={() => setRepliedFilter("false")} className={pillClass(filters.replied === "false")}>Unanswered</button>
            <button type="button" onClick={() => setRepliedFilter("true")} className={pillClass(filters.replied === "true")}>Replied</button>
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
            {filtersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {hasActiveFilters && (
            <Link
              href="/admin/contact"
              onClick={() => { setFromFilter(""); setToFilter(""); }}
              className="whitespace-nowrap text-xs text-red-600 hover:underline"
            >
              Clear all
            </Link>
          )}
        </div>

        {filtersOpen && (
          <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <label htmlFor="typeFilter" className="text-xs font-medium text-gray-500">Type:</label>
              <select
                id="typeFilter"
                value={filters.type ?? ""}
                onChange={(e) => router.push(buildUrl({ type: e.target.value || undefined }))}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              >
                <option value="">All</option>
                {CONTACT_INQUIRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="fromFilter" className="text-xs font-medium text-gray-500">From:</label>
              <input
                id="fromFilter" type="date" value={fromFilter}
                onChange={(e) => setFromFilter(e.target.value)}
                onBlur={(e) => { const v = e.target.value; if (!v || DATE_RE.test(v)) router.push(buildUrl({ from: v || undefined })); }}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label htmlFor="toFilter" className="text-xs font-medium text-gray-500">To:</label>
              <input
                id="toFilter" type="date" value={toFilter}
                onChange={(e) => setToFilter(e.target.value)}
                onBlur={(e) => { const v = e.target.value; if (!v || DATE_RE.test(v)) router.push(buildUrl({ to: v || undefined })); }}
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
              onClick={() => { setSearchQuery(""); if (hasActiveFilters) router.push("/admin/contact"); }}
              className="mt-2 text-sm text-red-600 hover:underline"
            >
              Clear {searchQuery.trim() && hasActiveFilters ? "search and filters" : searchQuery.trim() ? "search" : "filters"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {unanswered.length > 0 && (
            <section aria-label="Unanswered submissions">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
                Unanswered ({unanswered.length})
              </p>
              <div className="space-y-2">
                {unanswered.map((sub) => (
                  <SubmissionRow key={sub.id} accentClass="border-l-4 border-l-amber-400" {...rowProps(sub, () => handleMarkReplied(sub.id))} />
                ))}
              </div>
            </section>
          )}

          {replied.length > 0 && (
            <section aria-label="Replied submissions">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-600">
                Replied ({replied.length})
              </p>
              <div className="space-y-2">
                {replied.map((sub) => (
                  <SubmissionRow key={sub.id} accentClass="border-l-4 border-l-green-400" {...rowProps(sub, undefined)} />
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
  markingReplied: boolean;
  callingToggle: boolean;
  submissionNotes: ContactNote[] | undefined;
  notesLoading: boolean;
  addingNote: boolean;
  detailTab: "conversation" | "notes";
  onToggle: () => void;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onFilesChange: (files: File[]) => void;
  onSend: () => void;
  onMarkReplied: (() => void) | undefined;
  onToggleCalled: () => void;
  onAddNote: (body: string) => Promise<boolean>;
  onDetailTabChange: (tab: "conversation" | "notes") => void;
}

/**
 * A single submission accordion row. Collapsed: summary with name, type, and contact info.
 * Expanded: tabbed panel with Conversation (message + email thread + reply form) and
 * Notes (timestamped staff notes log with add form).
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
  submissionNotes,
  notesLoading,
  addingNote,
  detailTab,
  onToggle,
  onSubjectChange,
  onBodyChange,
  onFilesChange,
  onSend,
  onMarkReplied,
  onToggleCalled,
  onAddNote,
  onDetailTabChange,
}: SubmissionRowProps) {
  // Local state for the new-note textarea
  const [newNoteText, setNewNoteText] = useState("");

  async function handleSubmitNote() {
    const text = newNoteText.trim();
    if (!text) return;
    const ok = await onAddNote(text);
    if (ok) setNewNoteText("");
  }

  return (
    <div className={`${accentClass} ${sub.called ? "bg-blue-50/30" : "bg-white"} rounded-lg border border-gray-200 overflow-hidden`}>
      {/* Summary row: always visible */}
      <div className="flex w-full items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex flex-1 min-w-0 items-start gap-3 text-left focus:outline-none"
        >
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900">{sub.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${typeBadgeClass(sub.inquiry_type)}`}>
                {sub.inquiry_type}
              </span>
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
              <a href={`mailto:${sub.email}`} className="hover:text-red-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                {sub.email}
              </a>
              {sub.phone && (
                <a href={`tel:${sub.phone}`} className="hover:text-red-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                  {sub.phone}
                </a>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-600 line-clamp-1">
              {sub.message.slice(0, 120)}{sub.message.length > 120 ? "..." : ""}
            </p>
          </div>
        </button>

        {/* Right-side actions */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleCalled(); }}
            disabled={callingToggle}
            title={sub.called ? "Mark as not called" : "Mark as called"}
            className={`rounded p-1 transition-colors disabled:opacity-50 ${
              sub.called ? "text-blue-600 hover:bg-blue-100" : "text-gray-400 hover:bg-blue-50 hover:text-blue-600"
            }`}
          >
            {callingToggle ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
          </button>

          {onMarkReplied && (
            <button
              type="button"
              onClick={onMarkReplied}
              disabled={markingReplied}
              title="Mark as replied"
              className="rounded p-1 text-gray-400 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50"
            >
              {markingReplied ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            </button>
          )}

          <button type="button" onClick={onToggle} aria-expanded={isExpanded} className="flex flex-col items-end gap-1 focus:outline-none">
            <span title={fullDate(sub.created_at)} className="text-xs text-gray-400">{relativeTime(sub.created_at)}</span>
            {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
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

            {/* ── Conversation tab ──────────────────────────────────────────── */}
            {detailTab === "conversation" && (
              <>
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-gray-700">Original Message</h3>
                  <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-800 whitespace-pre-wrap">
                    {sub.message}
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400">Received {fullDate(sub.created_at)}</p>
                </section>

                {isZohoConnected && (
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-gray-700">Email Thread</h3>
                    {threadLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <RefreshCw className="h-4 w-4 animate-spin" /> Loading conversation...
                      </div>
                    ) : threadError ? (
                      <p className="text-sm text-red-600">{threadError}</p>
                    ) : !thread || thread.length === 0 ? (
                      <p className="text-sm text-gray-400">No previous emails with this contact.</p>
                    ) : (
                      <div className="space-y-3">
                        {thread.map((msg) => (
                          <div key={msg.id} className={`flex ${msg.isInbound ? "justify-start" : "justify-end"}`}>
                            <div className={`max-w-[85%] rounded-lg px-4 py-3 text-sm ${msg.isInbound ? "border border-gray-200 bg-white text-gray-800" : "bg-gray-200 text-gray-900"}`}>
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

                <section>
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">Send Reply</h3>
                  {!isZohoConnected ? (
                    <p className="text-sm text-gray-500">
                      Connect Zoho Mail in{" "}
                      <Link href="/admin/settings" className="text-red-600 underline hover:text-red-700">Settings</Link>{" "}
                      to send replies.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label htmlFor={`subject-${sub.id}`} className="mb-1 block text-xs font-medium text-gray-600">Subject</label>
                        <input
                          id={`subject-${sub.id}`} type="text" value={replySubject}
                          onChange={(e) => onSubjectChange(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                        />
                      </div>
                      <div>
                        <label htmlFor={`body-${sub.id}`} className="mb-1 block text-xs font-medium text-gray-600">
                          Message <span className="text-red-600">*</span>
                        </label>
                        <textarea
                          id={`body-${sub.id}`} rows={6} value={replyBody}
                          onChange={(e) => onBodyChange(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                          placeholder="Type your reply here…"
                        />
                      </div>
                      <div>
                        <label htmlFor={`files-${sub.id}`} className="mb-1 block text-xs font-medium text-gray-600">
                          Attachments{" "}
                          <span className="font-normal text-gray-400">(PDF, DOC, DOCX, JPG, PNG; max 10 MB each)</span>
                        </label>
                        <input
                          id={`files-${sub.id}`} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                          onChange={(e) => onFilesChange(Array.from(e.target.files ?? []))}
                          className="block w-full text-xs text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-gray-700 hover:file:bg-gray-200"
                        />
                        {replyFiles.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5">
                            {replyFiles.map((f, i) => (
                              <li key={i} className="flex items-center gap-1.5 text-xs text-gray-500">
                                <span>{f.name}</span>
                                <button type="button" onClick={() => onFilesChange(replyFiles.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${f.name}`}>
                                  <X className="h-3 w-3" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {replySuccess && <p className="text-sm font-semibold text-green-600">Reply sent successfully.</p>}
                      {replyError && <p className="text-sm text-red-600">{replyError}</p>}
                      <button
                        type="button" onClick={onSend}
                        disabled={replySending || !replySubject.trim() || !replyBody.trim()}
                        className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {replySending ? <><RefreshCw className="h-4 w-4 animate-spin" /> Sending…</> : <><Send className="h-4 w-4" /> Send Reply</>}
                      </button>
                    </div>
                  )}
                </section>
              </>
            )}

            {/* ── Notes tab ────────────────────────────────────────────────── */}
            {detailTab === "notes" && (
              <section className="space-y-4">
                {/* Add note form */}
                <div>
                  <label htmlFor={`note-${sub.id}`} className="mb-1.5 block text-sm font-semibold text-gray-700">
                    Add Note
                  </label>
                  <textarea
                    id={`note-${sub.id}`}
                    rows={3}
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    placeholder="Log a call, in-person conversation, or any follow-up detail…"
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleSubmitNote}
                      disabled={!newNoteText.trim() || addingNote}
                      className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {addingNote ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save Note"}
                    </button>
                  </div>
                </div>

                {/* Notes history */}
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">History</p>

                  {notesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <RefreshCw className="h-4 w-4 animate-spin" /> Loading notes…
                    </div>
                  ) : !submissionNotes || submissionNotes.length === 0 ? (
                    <p className="text-sm text-gray-400">No notes yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {submissionNotes.map((note) => (
                        <div key={note.id} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-800">
                              {note.created_by_name}
                            </span>
                            <span
                              title={fullDate(note.created_at)}
                              className="text-xs text-gray-400 whitespace-nowrap"
                            >
                              {fullDate(note.created_at)}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
