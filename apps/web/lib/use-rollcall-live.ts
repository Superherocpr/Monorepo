/**
 * use-rollcall-live.ts: shared live-update hook for the rollcall roster.
 * Used by: the check-in display (CheckinDisplayClient) and the instructor's
 * session page (SessionDetailClient).
 *
 * How updates arrive (push is the main mechanism; there is NO timer poll):
 *  1. A student verifies and the server broadcasts on the session's channel.
 *     We hand the payload to `onVerified` (instant UI) and schedule one
 *     debounced router.refresh() to reconcile the roster from the database.
 *  2. If the channel comes back after a drop, or the tab becomes visible again,
 *     we refresh once, because Realtime never replays missed broadcasts.
 *  3. `reconnect()` (the instructor's button) tears the channel down, subscribes
 *     again, and refreshes immediately. It also repairs the case the status
 *     cannot detect: a healthy socket where the server-side broadcast failed.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  REFRESH_DEBOUNCE_MS,
  ROLLCALL_VERIFIED_EVENT,
  connectionStateFromStatus,
  createTrailingDebounce,
  needsCatchUpRefresh,
  rollcallChannelTopic,
  type RollcallConnectionState,
  type RollcallVerifiedPayload,
} from "@/lib/rollcall-realtime";

interface Options {
  /** class_sessions.id whose channel to listen on. */
  sessionId: string;
  /** When false, no channel is opened (e.g. a completed session). */
  enabled?: boolean;
  /** Called with the payload of each broadcast, before the debounced refresh. */
  onVerified?: (payload: RollcallVerifiedPayload) => void;
}

interface Result {
  /** Health of the push channel. */
  connection: RollcallConnectionState;
  /** True while a router.refresh() the hook started is in flight. */
  refreshing: boolean;
  /** Resubscribes the channel and re-reads the roster right now. */
  reconnect: () => void;
}

/** A live channel plus the client that owns it (needed to remove it again). */
interface LiveChannel {
  supabase: SupabaseClient;
  channel: RealtimeChannel;
}

/**
 * Keeps a rollcall roster page in sync with check-ins over Realtime.
 * @param options - session to follow, whether to listen, and the broadcast callback
 * @returns connection health, refresh-in-flight flag, and a manual reconnect
 */
export function useRollcallLive({
  sessionId,
  enabled = true,
  onVerified,
}: Options): Result {
  const router = useRouter();
  const [connection, setConnection] = useState<RollcallConnectionState>("connecting");
  const [refreshing, startRefresh] = useTransition();

  // Latest callback/state in refs so the channel is not rebuilt on every render.
  const onVerifiedRef = useRef(onVerified);
  const connectionRef = useRef<RollcallConnectionState>("connecting");
  const liveRef = useRef<LiveChannel | null>(null);
  // Bumped on every (re)connect and on unmount. A removed channel still fires a
  // final CLOSED callback; the generation check stops it overwriting fresh state.
  const generationRef = useRef(0);

  useEffect(() => {
    onVerifiedRef.current = onVerified;
  });

  /**
   * Re-reads the server-rendered roster; wrapped in a transition for `refreshing`.
   * useRouter() returns a stable instance, so the debounce below can safely
   * capture this function once.
   */
  const refreshNow = useCallback((): void => {
    startRefresh(() => {
      router.refresh();
    });
  }, [router]);

  const [debouncedRefresh] = useState(() =>
    createTrailingDebounce(refreshNow, REFRESH_DEBOUNCE_MS)
  );

  /** Records a new connection state in both the ref (for logic) and state (for UI). */
  const applyState = useCallback((next: RollcallConnectionState): void => {
    connectionRef.current = next;
    setConnection(next);
  }, []);

  /** Opens the channel and wires broadcast + status handlers for this generation. */
  const connect = useCallback((): void => {
    const generation = ++generationRef.current;
    const supabase = createClient();
    const channel = supabase
      .channel(rollcallChannelTopic(sessionId))
      .on("broadcast", { event: ROLLCALL_VERIFIED_EVENT }, (message) => {
        if (generation !== generationRef.current) return;
        const payload = message.payload as RollcallVerifiedPayload | undefined;
        if (payload?.firstName) onVerifiedRef.current?.(payload);
        debouncedRefresh.call();
      })
      .subscribe((status) => {
        if (generation !== generationRef.current) return;
        const prev = connectionRef.current;
        const next = connectionStateFromStatus(status);
        applyState(next);
        // Broadcasts sent while we were down are gone: re-read once on recovery.
        if (needsCatchUpRefresh(prev, next)) debouncedRefresh.call();
      });
    liveRef.current = { supabase, channel };
  }, [sessionId, applyState, debouncedRefresh]);

  /**
   * Removes the current channel, if any, and bumps the generation so any late
   * callback from it (its final CLOSED) is ignored.
   */
  const disconnect = useCallback((): void => {
    generationRef.current++;
    const live = liveRef.current;
    liveRef.current = null;
    if (live) void live.supabase.removeChannel(live.channel);
  }, []);

  const reconnect = useCallback((): void => {
    debouncedRefresh.cancel();
    disconnect();
    applyState("connecting");
    connect();
    refreshNow();
  }, [applyState, connect, debouncedRefresh, disconnect, refreshNow]);

  useEffect(() => {
    if (!enabled) return;
    connect();

    // A tab that was hidden may have missed broadcasts (timers and sockets are
    // throttled in the background). Coming back: resubscribe if down, else
    // one refresh. Event-driven, so an open display costs nothing while idle.
    const onVisibility = (): void => {
      if (document.visibilityState !== "visible") return;
      if (connectionRef.current === "disconnected") reconnect();
      else debouncedRefresh.call();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      debouncedRefresh.cancel();
      disconnect();
    };
  }, [enabled, connect, disconnect, reconnect, debouncedRefresh]);

  return { connection, refreshing, reconnect };
}
