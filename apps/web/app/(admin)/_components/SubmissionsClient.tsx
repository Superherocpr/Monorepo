"use client";

/**
 * SubmissionsClient — client component for the admin contact submissions page.
 * Renders the filter bar, the grouped submission list (unanswered / replied),
 * per-submission expand/collapse accordion, Zoho email thread display, and
 * the reply form. Used by: app/(admin)/admin/contact/page.tsx
 */

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Mail, RefreshCw, Search, Send, X } from "lucide-react";

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
  userRole: string;
}

// ── Inquiry type options (must match contact_submissions.inquiry_type values) ──
const INQUIRY_TYPES = [
  "General Question",
  "Group Booking",
  "Corporate Training",
  "Certification Renewal",
  "Other",
];

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
    case "Group Booking":
      return "bg-blue-100 text-blue-700";
    case "Corporate Training":
      return "bg-purple-100 text-purple-700";
    case "Certification Renewal":
      return "bg-green-100 text-green-700";
    case "General Question":
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

/** Client component for the contact submissions page. */
export default function SubmissionsClient({
  initialSubmissions,
  filters,
  isZohoConnected,
}: SubmissionsClientProps) {
  const router = useRouter();

  // ── Local filter state (mirrors URL params for controlled inputs) ──────────
  const [typeFilter, setTypeFilter] = useState(filters.type ?? "");
  const [fromFilter, setFromFilter] = useState(filters.from ?? "");
  const [toFilter, setToFilter] = useState(filters.to ?? "");

  // ── Client-side text search (filters the already-loaded list in real time) ─
  const [searchQuery, setSearchQuery] = useState("");

  // Sync filter inputs when the server re-renders with new filter props after
  // router.push() — useState only initializes from props on first mount.
  useEffect(() => {
    setTypeFilter(filters.type ?? "");
    setFromFilter(filters.from ?? "");
    setToFilter(filters.to ?? "");
  }, [filters.type, filters.from, filters.to]);

  // ── Accordion state ────────────────────────────────────────────────────────
  /** ID of the currently expanded submission (only one open at a time). */
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  // ── Local submission list (updated after a successful reply send) ──────────
  const [submissions, setSubmissions] = useState<SubmissionWithReplies[]>(
    initialSubmissions
  );

  // Sync submission list when the server re-renders with new filtered results.
  useEffect(() => {
    setSubmissions(initialSubmissions);
  }, [initialSubmissions]);

  // ── URL helpers ────────────────────────────────────────────────────────────

  /**
   * Builds the URL with updated filter query params.
   * Omits empty values to keep URLs clean.
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

  const hasActiveFilters =
    !!filters.type || !!filters.replied || !!filters.from || !!filters.to;

  // ── Status pill navigation ─────────────────────────────────────────────────

  /**
   * Navigates to the URL with the replied filter set.
   * @param value - "all" clears the filter; "false" = unanswered; "true" = replied.
   */
  function setRepliedFilter(value: "all" | "false" | "true") {
    router.push(buildUrl({ replied: value === "all" ? undefined : value }));
  }

  /**
   * Submits the date range / type filter form by navigating to the new URL.
   * @param e - The form submit event.
   */
  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(
      buildUrl({
        type: typeFilter || undefined,
        from: fromFilter || undefined,
        to: toFilter || undefined,
      })
    );
  }

  // ── Accordion expand/collapse ──────────────────────────────────────────────

  /**
   * Toggles the expand state for a submission row. When expanding, loads the
   * Zoho thread for that submission's email if it hasn't been loaded yet.
   * Resets the reply form when switching to a different submission.
   * @param sub - The submission being toggled.
   */
  const handleToggle = useCallback(
    async (sub: SubmissionWithReplies) => {
      if (expandedId === sub.id) {
        // Collapse
        setExpandedId(null);
        return;
      }

      // Expanding a new submission — reset reply form
      setExpandedId(sub.id);
      setReplySubject(`Re: ${sub.inquiry_type} inquiry from ${sub.name}`);
      setReplyBody("");
      setReplyFiles([]);
      setReplySuccess(false);
      setReplyError(null);

      // Load thread if not already loaded and Zoho is connected
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

  // ── Reply send ─────────────────────────────────────────────────────────────

  /**
   * Submits the reply form. Sends the email via Zoho (POST /api/contact/reply)
   * and updates the local submission list to reflect the replied status.
   * Attachments are included if S3 upload is configured — see TODO below.
   * @param submissionId - The ID of the submission being replied to.
   */
  async function handleSendReply(submissionId: string) {
    if (!replySubject.trim() || !replyBody.trim()) return;

    setReplySending(true);
    setReplyError(null);

    // TODO: Upload replyFiles to S3 via /api/contact/upload-attachment before sending.
    // AWS SDK not yet installed. For now, attachmentUrls is always empty.
    const attachmentUrls: string[] = [];

    try {
      const res = await fetch("/api/contact/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          subject: replySubject.trim(),
          body: replyBody.trim(),
          attachmentUrls,
        }),
      });

      const json = (await res.json()) as { success: boolean; error?: string };

      if (!json.success) {
        setReplyError(json.error ?? "Failed to send reply.");
        return;
      }

      // Mark submission as replied locally so UI updates immediately
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

      // Reload the thread to show the new reply
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
  // Matches name, email, phone, and message body — case-insensitive.
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

  // ── Split submissions into two sections ────────────────────────────────────
  const unanswered = displayedSubmissions.filter((s) => !s.replied);
  const replied = displayedSubmissions.filter((s) => s.replied);

  // ── Pill button helper ────────────────────────────────────────────────────

  function pillClass(active: boolean) {
    return active
      ? "rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white"
      : "rounded-full bg-white px-3 py-1 text-xs font-semibold text-gray-600 ring-1 ring-inset ring-gray-300 hover:bg-gray-50";
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Zoho not connected — setup prompt */}
      {!isZohoConnected && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <Mail className="h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">
            Zoho Mail is not connected. Email threads and reply sending are
            unavailable.{" "}
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
          placeholder="Search by name, email, phone, or message… (set Status to All for best results)"
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
      <form
        onSubmit={handleFilterSubmit}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
      >
        {/* Status pills */}
        <div className="flex flex-wrap items-center gap-1.5">
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

        {/* Inquiry type dropdown */}
        <div className="flex items-center gap-2">
          <label htmlFor="typeFilter" className="text-xs font-medium text-gray-500">
            Type:
          </label>
          <select
            id="typeFilter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          >
            <option value="">All</option>
            {INQUIRY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="fromFilter" className="text-xs font-medium text-gray-500">
            From:
          </label>
          <input
            id="fromFilter"
            type="date"
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
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
            className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
        </div>

        <button
          type="submit"
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
        >
          Apply
        </button>

        {hasActiveFilters && (
          <Link
            href="/admin/contact"
            onClick={() => {
              setTypeFilter("");
              setFromFilter("");
              setToFilter("");
            }}
            className="text-xs text-red-600 hover:underline"
          >
            Clear filters
          </Link>
        )}
      </form>

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
              Clear {searchQuery.trim() && hasActiveFilters ? "search and filters" : searchQuery.trim() ? "search" : "filters"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Unanswered section ──────────────────────────────────────────── */}
          {unanswered.length > 0 && (
            <section aria-label="Unanswered submissions">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
                Unanswered
              </p>
              <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
                {unanswered.map((sub) => (
                  <SubmissionRow
                    key={sub.id}
                    sub={sub}
                    isExpanded={expandedId === sub.id}
                    accentClass="border-l-4 border-l-amber-400"
                    thread={threads[sub.id]}
                    threadLoading={threadLoading === sub.id}
                    threadError={expandedId === sub.id ? threadError : null}
                    isZohoConnected={isZohoConnected}
                    replySubject={expandedId === sub.id ? replySubject : ""}
                    replyBody={expandedId === sub.id ? replyBody : ""}
                    replyFiles={expandedId === sub.id ? replyFiles : []}
                    replySending={expandedId === sub.id && replySending}
                    replySuccess={expandedId === sub.id && replySuccess}
                    replyError={expandedId === sub.id ? replyError : null}
                    onToggle={() => handleToggle(sub)}
                    onSubjectChange={setReplySubject}
                    onBodyChange={setReplyBody}
                    onFilesChange={setReplyFiles}
                    onSend={() => handleSendReply(sub.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Replied section ──────────────────────────────────────────────── */}
          {replied.length > 0 && (
            <section aria-label="Replied submissions">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-600">
                Replied
              </p>
              <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
                {replied.map((sub) => (
                  <SubmissionRow
                    key={sub.id}
                    sub={sub}
                    isExpanded={expandedId === sub.id}
                    accentClass="border-l-4 border-l-green-400"
                    thread={threads[sub.id]}
                    threadLoading={threadLoading === sub.id}
                    threadError={expandedId === sub.id ? threadError : null}
                    isZohoConnected={isZohoConnected}
                    replySubject={expandedId === sub.id ? replySubject : ""}
                    replyBody={expandedId === sub.id ? replyBody : ""}
                    replyFiles={expandedId === sub.id ? replyFiles : []}
                    replySending={expandedId === sub.id && replySending}
                    replySuccess={expandedId === sub.id && replySuccess}
                    replyError={expandedId === sub.id ? replyError : null}
                    onToggle={() => handleToggle(sub)}
                    onSubjectChange={setReplySubject}
                    onBodyChange={setReplyBody}
                    onFilesChange={setReplyFiles}
                    onSend={() => handleSendReply(sub.id)}
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
  onToggle: () => void;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onFilesChange: (files: File[]) => void;
  onSend: () => void;
}

/**
 * A single submission accordion row. Shows a summary line when collapsed and
 * the full message + thread + reply form when expanded.
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
  onToggle,
  onSubjectChange,
  onBodyChange,
  onFilesChange,
  onSend,
}: SubmissionRowProps) {
  return (
    <div className={accentClass}>
      {/* Summary row — always visible */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 focus:outline-none"
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900">{sub.name}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${typeBadgeClass(sub.inquiry_type)}`}
            >
              {sub.inquiry_type}
            </span>
            {sub.replied ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                Replied
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                Awaiting Reply
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
            {sub.phone && <span>{sub.phone}</span>}
          </div>
          <p className="mt-1 text-sm text-gray-600 line-clamp-1">
            {sub.message.slice(0, 120)}
            {sub.message.length > 120 ? "..." : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            title={fullDate(sub.created_at)}
            className="text-xs text-gray-400"
          >
            {relativeTime(sub.created_at)}
          </span>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded detail panel */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 py-5 space-y-6 bg-gray-50">
          {/* Original message */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">
              Original Message
            </h3>
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
              <h3 className="mb-2 text-sm font-semibold text-gray-700">
                Email Thread
              </h3>

              {threadLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Loading conversation...
                </div>
              ) : threadError ? (
                <p className="text-sm text-red-600">{threadError}</p>
              ) : !thread || thread.length === 0 ? (
                <p className="text-sm text-gray-400">
                  No previous emails with this contact.
                </p>
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
                          <span className="font-semibold text-xs">
                            {msg.from}
                          </span>
                          <span className="text-xs text-gray-400">
                            {fullDate(msg.date)}
                          </span>
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
            <h3 className="mb-3 text-sm font-semibold text-gray-700">
              Send Reply
            </h3>

            {!isZohoConnected ? (
              <p className="text-sm text-gray-500">
                Connect Zoho Mail in{" "}
                <Link
                  href="/admin/settings"
                  className="text-red-600 underline hover:text-red-700"
                >
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
                    placeholder="Type your reply here..."
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
                      (PDF, DOC, DOCX, JPG, PNG — max 10MB each)
                    </span>
                  </label>
                  <input
                    id={`files-${sub.id}`}
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    onChange={(e) =>
                      onFilesChange(Array.from(e.target.files ?? []))
                    }
                    className="block w-full text-xs text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-gray-700 hover:file:bg-gray-200"
                  />
                  {/* Show selected file names */}
                  {replyFiles.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {replyFiles.map((f, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-1.5 text-xs text-gray-500"
                        >
                          <span>{f.name}</span>
                          <button
                            type="button"
                            onClick={() =>
                              onFilesChange(
                                replyFiles.filter((_, idx) => idx !== i)
                              )
                            }
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
                  <p className="text-sm font-semibold text-green-600">
                    Reply sent successfully.
                  </p>
                )}
                {replyError && (
                  <p className="text-sm text-red-600">{replyError}</p>
                )}

                {/* Send button */}
                <button
                  type="button"
                  onClick={onSend}
                  disabled={
                    replySending || !replySubject.trim() || !replyBody.trim()
                  }
                  className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {replySending ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Sending...
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
        </div>
      )}
    </div>
  );
}
