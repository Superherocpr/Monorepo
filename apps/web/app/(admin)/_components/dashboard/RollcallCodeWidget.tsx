/**
 * RollcallCodeWidget — displays the instructor's daily rollcall code with a refresh button.
 * Calls POST /api/rollcall/refresh-my-code to generate a new code without a full page reload.
 * Used by: InstructorDashboard
 */

"use client";

import { useState } from "react";
import Link from "next/link";

interface Props {
  /** The current daily_access_code from the server. Null if none has been generated yet. */
  initialCode: string | null;
}

/**
 * Shows the 6-digit rollcall code and lets the instructor request a fresh one.
 * @param initialCode - Server-rendered code value passed at page load
 */
export default function RollcallCodeWidget({ initialCode }: Props) {
  const [code, setCode] = useState<string | null>(initialCode);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Requests a new daily_access_code from the server and updates the display.
   */
  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/rollcall/refresh-my-code", { method: "POST" });
      const data = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !data.code) {
        setError(data.error ?? "Failed to refresh code. Please try again.");
        return;
      }
      setCode(data.code);
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Today&apos;s Rollcall Code
      </h2>

      {code ? (
        <p
          className="text-5xl font-mono font-bold text-red-600 tracking-widest"
          aria-label={`Today's rollcall code: ${code}`}
        >
          {code}
        </p>
      ) : (
        <p className="text-gray-400 text-sm">No code generated yet.</p>
      )}

      <p className="text-xs text-gray-400 mt-2">
        Students enter this at{" "}
        <Link href="/rollcall" className="underline hover:text-gray-600">
          /rollcall
        </Link>{" "}
        to check in.
      </p>

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
