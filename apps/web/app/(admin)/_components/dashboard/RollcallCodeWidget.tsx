/**
 * RollcallCodeWidget — displays the instructor's rollcall code with auto-refresh.
 * The code is valid for the whole business day (Eastern) it was generated on —
 * matches /api/rollcall/verify-code. Auto-refreshes via
 * POST /api/rollcall/refresh-my-code at the midnight rollover, and supports
 * manual refresh as well.
 * Used by: InstructorDashboard, SuperAdminDashboard
 */

"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { isSameBusinessDay } from "@/lib/business-time";

interface Props {
  /** The current daily_access_code from the server. Null if none has been generated yet. */
  initialCode: string | null;
  /** ISO timestamp when the current code was generated. Null if no code exists. */
  initialGeneratedAt: string | null;
}

/**
 * True when the code is no longer valid — i.e. it was generated on a previous
 * business day (or never). Mirrors the server-side check in verify-code.
 * @param generatedAt - ISO timestamp the code was generated
 */
function isExpired(generatedAt: string | null): boolean {
  if (!generatedAt) return true;
  return !isSameBusinessDay(new Date(generatedAt), new Date());
}

/**
 * Shows the 6-digit rollcall code and lets the instructor request a fresh one
 * manually. Auto-refreshes when the business day rolls over at midnight ET.
 * @param initialCode - Server-rendered code value passed at page load
 * @param initialGeneratedAt - ISO timestamp the current code was generated
 */
export default function RollcallCodeWidget({ initialCode, initialGeneratedAt }: Props) {
  const [code, setCode] = useState<string | null>(initialCode);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt);
  const [expired, setExpired] = useState<boolean>(() => isExpired(initialGeneratedAt));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRefreshScheduled = useRef(false);

  /**
   * Requests a new code from the server and updates local state.
   */
  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    autoRefreshScheduled.current = false;
    try {
      const res = await fetch("/api/rollcall/refresh-my-code", { method: "POST" });
      const data = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !data.code) {
        setError(data.error ?? "Failed to refresh code. Please try again.");
        return;
      }
      const now = new Date().toISOString();
      setCode(data.code);
      setGeneratedAt(now);
      setExpired(false);
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }

  // Check for the midnight-ET rollover twice a minute and auto-refresh when
  // the business day changes (e.g. dashboard left open overnight).
  useEffect(() => {
    const interval = setInterval(() => {
      const stale = isExpired(generatedAt);
      setExpired(stale);

      if (stale && !autoRefreshScheduled.current && !refreshing) {
        autoRefreshScheduled.current = true;
        void handleRefresh();
      }
    }, 30_000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedAt, refreshing]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Today&apos;s Rollcall Code
      </h2>

      {code ? (
        <p
          className={`text-5xl font-mono font-bold tracking-widest ${expired ? "text-gray-300" : "text-red-600"}`}
          aria-label={`Rollcall code: ${code}`}
        >
          {code}
        </p>
      ) : (
        <p className="text-gray-400 text-sm">No code generated yet.</p>
      )}

      {/* Validity note — only shown when a code exists and we have a timestamp */}
      {code && generatedAt && (
        <p className="text-xs mt-1 text-gray-400">
          {refreshing
            ? "Refreshing…"
            : expired
              ? "Expired — refreshing…"
              : "Valid all day — expires at midnight (ET)"}
        </p>
      )}

      <p className="text-xs text-gray-400 mt-2">
        Students enter this at{" "}
        <Link href="/rollcall" className="underline hover:text-gray-600">
          /rollcall
        </Link>{" "}
        to check in.
      </p>

      {/* Quick link to Enrollware class list — useful when teaching a class */}
      <a
        href="https://www.enrollware.com/admin/class-edit.aspx?ret=class-list.aspx&id=new"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
      >
        {/* External link icon */}
        <svg
          className="w-3.5 h-3.5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
          />
        </svg>
        Open Enrollware
      </a>

      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="mt-4 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
        aria-label="Generate a new rollcall code"
      >
        {/* Refresh icon */}
        <svg
          className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-3.36M19.87 15A9 9 0 015.87 18.36"
          />
        </svg>
        {refreshing ? "Refreshing…" : "Get new code"}
      </button>

      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  );
}
