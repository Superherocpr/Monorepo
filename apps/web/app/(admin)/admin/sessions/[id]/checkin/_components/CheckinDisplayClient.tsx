"use client";

/**
 * CheckinDisplayClient — classroom-facing rollcall display.
 * Renders a full-viewport branded page (covers the admin chrome) with a large
 * QR code, the plaintext rollcall code, check-in instructions, and a live
 * list of students who have verified for this session. The list updates via
 * the existing per-session Supabase Realtime broadcast (no reload needed),
 * with a slow poll as a fallback for dropped websockets.
 * Used by: app/(admin)/admin/sessions/[id]/checkin/page.tsx
 */

import { useState, useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, RefreshCw, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ROLLCALL_VERIFIED_EVENT,
  rollcallChannelTopic,
  type RollcallVerifiedPayload,
} from "@/lib/rollcall-realtime";

/** A student who has confirmed their info via rollcall. */
export interface VerifiedStudent {
  firstName: string;
  lastName: string;
}

interface Props {
  sessionId: string;
  classTypeName: string;
  locationName: string;
  startsAt: string;
  /** Current valid rollcall code, or null if expired / never generated. */
  initialCode: string | null;
  /** Students already verified when the page rendered on the server. */
  initialVerified: VerifiedStudent[];
}

/** Fallback origin for the QR URL during SSR; replaced with the real origin on mount. */
const FALLBACK_ORIGIN = "https://superherocpr.com";

/** Poll interval for the verified-list fallback refresh (ms). */
const POLL_INTERVAL_MS = 30_000;

/** Dedupe key for a verified student (names are what the broadcast carries). */
function studentKey(s: VerifiedStudent): string {
  return `${s.firstName.trim().toLowerCase()}|${s.lastName.trim().toLowerCase()}`;
}

/**
 * Formats an ISO datetime to a short time string, e.g. "9:00 AM".
 * @param iso - ISO date string
 */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "UTC", // class times are floating wall-clock values
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Full-viewport rollcall display: branded header, QR + code panel, and the
 * live verified-student list. The QR encodes /rollcall?code=X&session=Y so a
 * scan skips both code entry and the session picker.
 */
export default function CheckinDisplayClient({
  sessionId,
  classTypeName,
  locationName,
  startsAt,
  initialCode,
  initialVerified,
}: Props): React.ReactElement {
  const router = useRouter();

  const [code, setCode] = useState<string | null>(initialCode);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real origin so the QR works on staging/dev too. useSyncExternalStore is
  // the hydration-safe way to read a client-only value: the server snapshot
  // renders first, then the real origin swaps in (identical in production).
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => FALLBACK_ORIGIN
  );

  // Names received over the live broadcast since the page loaded. Merged with
  // the server-fetched list; router.refresh() reconciles the authoritative
  // roster on each poll or broadcast.
  const [broadcastVerified, setBroadcastVerified] = useState<VerifiedStudent[]>([]);

  // ── Live updates ───────────────────────────────────────────────────────────
  // Same channel + fallback pattern as SessionDetailClient: broadcast for
  // instant updates, slow poll in case the websocket drops silently.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(rollcallChannelTopic(sessionId))
      .on("broadcast", { event: ROLLCALL_VERIFIED_EVENT }, (message) => {
        const payload = message.payload as RollcallVerifiedPayload;
        if (payload?.firstName) {
          setBroadcastVerified((prev) => [...prev, payload]);
        }
        router.refresh();
      })
      .subscribe();

    const pollInterval = setInterval(() => {
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [sessionId, router]);

  /** Server list ∪ broadcast list, deduped — server order first, newest broadcasts last. */
  const verified = useMemo(() => {
    const seen = new Set<string>();
    const merged: VerifiedStudent[] = [];
    for (const s of [...initialVerified, ...broadcastVerified]) {
      const key = studentKey(s);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(s);
      }
    }
    return merged;
  }, [initialVerified, broadcastVerified]);

  // ── Code refresh ───────────────────────────────────────────────────────────

  /** Generates a fresh code; the QR re-renders from the same state atomically. */
  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/rollcall/refresh-my-code", { method: "POST" });
      const data = (await res.json()) as { code?: string; error?: string };
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

  const qrUrl = code
    ? `${origin}/rollcall?code=${code}&session=${sessionId}`
    : `${origin}/rollcall`;

  return (
    // Fixed full-viewport layer — covers the admin sidebar/top bar so the
    // projected page is clean. Always light regardless of admin dark mode:
    // QR codes need a light background to scan reliably.
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto flex flex-col">
      {/* Brand accent stripe */}
      <div className="h-2 w-full shrink-0" style={{ backgroundColor: "#CC1122" }} />

      {/* Header — text logo + session info + back link */}
      <header className="flex items-center justify-between px-6 sm:px-10 py-4 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-6">
          <p className="flex items-baseline gap-0.5 leading-none select-none">
            <span className="text-2xl font-black tracking-tight text-gray-900">
              SuperHero
            </span>
            <span
              className="text-2xl font-black tracking-tight"
              style={{ color: "#CC1122" }}
            >
              CPR
            </span>
          </p>
          <p className="hidden sm:block text-sm text-gray-500">
            {classTypeName} · {formatTime(startsAt)}
            {locationName ? ` · ${locationName}` : ""}
          </p>
        </div>

        <Link
          href={`/admin/sessions/${sessionId}`}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to session
        </Link>
      </header>

      {/* Main content — QR panel + verified list, side by side on wide screens */}
      <div className="flex-1 flex flex-col lg:flex-row gap-8 px-6 sm:px-10 py-8 max-w-7xl w-full mx-auto">

        {/* ── QR + code panel ── */}
        <section className="flex-1 flex flex-col items-center justify-center text-center">
          {code ? (
            <div className="border-4 border-gray-900 rounded-2xl p-4 bg-white">
              <QRCodeSVG
                value={qrUrl}
                size={340}
                bgColor="#ffffff"
                fgColor="#111111"
                level="M"
                className="w-[min(70vw,340px)] h-auto"
              />
            </div>
          ) : (
            <div className="w-[min(70vw,340px)] aspect-square border-4 border-dashed border-gray-200 rounded-2xl flex items-center justify-center">
              <p className="text-gray-400 text-sm px-6">
                No active code for today. Click &ldquo;Get new code&rdquo; below.
              </p>
            </div>
          )}

          {/* Plaintext code — for anyone who can't scan */}
          <p className="text-6xl sm:text-7xl font-mono font-bold tracking-widest text-gray-900 mt-8">
            {code ?? "——————"}
          </p>

          <p className="text-gray-500 text-lg mt-4 max-w-md leading-relaxed">
            Scan the QR code, or go to{" "}
            <span className="font-semibold text-gray-800">
              superherocpr.com/rollcall
            </span>{" "}
            and enter the code above.
          </p>

          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="mt-8 flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
            aria-label="Generate a new rollcall code"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Get new code"}
          </button>

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </section>

        {/* ── Verified students list ── */}
        <section className="lg:w-96 shrink-0 flex flex-col">
          <div className="border border-gray-200 rounded-2xl flex-1 flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Checked In
              </h2>
              <span className="text-sm font-bold text-gray-900 tabular-nums">
                {verified.length}
              </span>
            </div>

            {verified.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-gray-400">
                No one has checked in yet. Names appear here the moment a
                student verifies.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 overflow-y-auto">
                {verified.map((s) => (
                  <li
                    key={studentKey(s)}
                    className="px-6 py-3 flex items-center gap-3"
                  >
                    <CheckCircle2
                      className="w-5 h-5 text-green-600 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="text-lg font-medium text-gray-900">
                      {s.firstName} {s.lastName}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
