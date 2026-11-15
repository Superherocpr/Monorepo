/**
 * rollcall-realtime.ts — shared constants for the rollcall live-update channel.
 *
 * Used by: app/api/rollcall/checkin-by-profile/route.ts (broadcasts on
 * check-in) and lib/use-rollcall-live.ts (listens, for the check-in display
 * and SessionDetailClient, so the roster updates without a manual page reload).
 *
 * This is a public (non-private) Supabase Realtime broadcast channel — no
 * table data flows over it, so it needs no RLS policy. The session UUID
 * scoping the topic is the same non-guessable capability token already used
 * to gate every other rollcall endpoint (session-students, student-profile,
 * checkin-by-profile), so exposure here is consistent with that model. Only
 * first/last name are broadcast — the same fields session-students already
 * exposes to anyone holding the sessionId; email/phone/address are not sent.
 */

/** Broadcast event name for a completed student check-in. */
export const ROLLCALL_VERIFIED_EVENT = "student_verified";

/**
 * Builds the channel topic for a given session's rollcall live updates.
 * @param sessionId - the class_sessions.id to scope the channel to
 */
export function rollcallChannelTopic(sessionId: string): string {
  return `rollcall:session:${sessionId}`;
}

/** Payload shape sent with the ROLLCALL_VERIFIED_EVENT broadcast. */
export interface RollcallVerifiedPayload {
  firstName: string;
  lastName: string;
}

// ── Client-side live-update helpers ──────────────────────────────────────────
// Shared by the check-in display and the session detail page (via
// lib/use-rollcall-live.ts). Kept free of React and Supabase so the decisions
// that matter (is the push healthy, should we catch up) are unit-testable.

/**
 * How long to wait after the last broadcast before re-reading the roster (ms).
 * At class start a dozen students can verify within seconds; each broadcast
 * already shows the name instantly from local state, so the authoritative
 * server re-read can safely be coalesced into one request.
 */
export const REFRESH_DEBOUNCE_MS = 1500;

/** Health of the live-update channel, as shown to the instructor. */
export type RollcallConnectionState = "connecting" | "connected" | "disconnected";

/**
 * Maps a Supabase channel subscribe status to what the instructor sees.
 * SUBSCRIBED is the only healthy state; errors, timeouts, and closes mean a
 * broadcast sent right now would be lost (Realtime never replays missed ones).
 * @param status - status string from channel.subscribe's callback
 */
export function connectionStateFromStatus(status: string): RollcallConnectionState {
  switch (status) {
    case "SUBSCRIBED":
      return "connected";
    case "CHANNEL_ERROR":
    case "TIMED_OUT":
    case "CLOSED":
      return "disconnected";
    default:
      return "connecting";
  }
}

/**
 * True when the channel has just come back after being down. Broadcasts sent
 * during the outage are gone for good, so the page must re-read the roster
 * once. The first connect of a page load does not count: the server render
 * is already fresh.
 * @param prev - state before this status change
 * @param next - state after this status change
 */
export function needsCatchUpRefresh(
  prev: RollcallConnectionState,
  next: RollcallConnectionState
): boolean {
  return prev === "disconnected" && next === "connected";
}

/** A trailing-edge debounced function with a cancel handle. */
export interface TrailingDebounce {
  /** Schedules the wrapped function; resets the timer if already pending. */
  call: () => void;
  /** Drops a pending call without running it. */
  cancel: () => void;
}

/**
 * Wraps `fn` so a burst of calls produces one run, `waitMs` after the last.
 * @param fn - function to run once the burst settles
 * @param waitMs - quiet period required before running
 */
export function createTrailingDebounce(fn: () => void, waitMs: number): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, waitMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
