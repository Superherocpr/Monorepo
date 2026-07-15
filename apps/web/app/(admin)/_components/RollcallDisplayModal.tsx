"use client";

/**
 * RollcallDisplayModal — full-viewport overlay for classroom check-in display.
 * Shows the instructor's rollcall QR code and 6-digit code large enough to be
 * scanned or read from across the room. The QR encodes the rollcall URL with
 * the code pre-filled so scanning skips manual entry entirely.
 * Used by: SessionDetailClient
 */

import { useState, useEffect, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, RefreshCw } from "lucide-react";

interface Props {
  onClose: () => void;
}

interface MyCodeResponse {
  code: string | null;
  generatedAt: string | null;
  error?: string;
}

interface RefreshResponse {
  code?: string;
  error?: string;
}

/** Base URL students navigate to when they scan the QR. */
const ROLLCALL_BASE_URL = "https://superherocpr.com/rollcall";

/**
 * Full-viewport modal that displays the instructor's rollcall QR code and
 * plaintext code for classroom display. Fetches the current code on mount
 * and allows manual refresh via the existing refresh-my-code endpoint.
 * @param onClose - called when the user dismisses the modal
 */
export default function RollcallDisplayModal({ onClose }: Props): React.ReactElement {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Loads the current code from the server on mount. */
  const fetchCurrentCode = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rollcall/my-code");
      const data = (await res.json()) as MyCodeResponse;
      if (!res.ok || data.error) {
        setError(data.error ?? "Failed to load code.");
        return;
      }
      setCode(data.code);
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCurrentCode();
  }, [fetchCurrentCode]);

  // Close on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  /** Generates a fresh code and updates the QR without closing the modal. */
  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/rollcall/refresh-my-code", { method: "POST" });
      const data = (await res.json()) as RefreshResponse;
      if (!res.ok || !data.code) {
        setError(data.error ?? "Failed to refresh. Please try again.");
        return;
      }
      setCode(data.code);
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }

  const qrUrl = code ? `${ROLLCALL_BASE_URL}?code=${code}` : ROLLCALL_BASE_URL;

  return (
    // Backdrop — fixed overlay, dark semi-transparent background
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => {
        // Close when clicking the backdrop, not the modal content
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl flex flex-col items-center justify-center w-full max-w-2xl py-10 px-8 max-h-[90vh]">

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <X className="w-6 h-6" />
        </button>

        {loading ? (
          <div className="flex flex-col items-center gap-4 py-16">
            <div className="w-12 h-12 border-4 border-gray-200 border-t-red-600 rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Loading code…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-4 py-16">
            <p className="text-red-600 text-sm text-center">{error}</p>
            <button
              type="button"
              onClick={() => void fetchCurrentCode()}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-500 uppercase tracking-widest mb-6">
              Check-In
            </h2>

            {/* QR code */}
            {code ? (
              <div className="border-4 border-gray-900 rounded-xl p-3">
                <QRCodeSVG
                  value={qrUrl}
                  size={280}
                  bgColor="#ffffff"
                  fgColor="#111111"
                  level="M"
                />
              </div>
            ) : (
              <div className="w-72 h-72 border-4 border-dashed border-gray-200 rounded-xl flex items-center justify-center">
                <p className="text-gray-400 text-sm text-center px-4">
                  No code generated yet. Click &ldquo;Get new code&rdquo; below.
                </p>
              </div>
            )}

            {/* Plain-text code — large mono, for anyone who can't scan */}
            <p className="text-6xl font-mono font-bold tracking-widest text-gray-900 mt-8">
              {code ?? "——————"}
            </p>

            {/* Instructions */}
            <p className="text-gray-500 text-center text-base mt-4 max-w-sm leading-relaxed">
              Scan the QR code, or go to{" "}
              <span className="font-semibold text-gray-700">superherocpr.com/rollcall</span>{" "}
              and enter the code above.
            </p>

            {/* Refresh button */}
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="mt-8 flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 transition-colors"
              aria-label="Generate a new rollcall code"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Get new code"}
            </button>

            {error && (
              <p className="text-xs text-red-500 mt-3 text-center">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
