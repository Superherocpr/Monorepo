/**
 * Unit tests for lib/use-rollcall-live.ts
 *
 * Covers the live-roster contract the instructor relies on: a broadcast shows
 * the name at once and triggers ONE debounced refresh (bursts coalesce), there
 * is NO timer poll, the roster is re-read after a dropped channel recovers
 * (broadcasts are never replayed), and the Refresh button (reconnect) swaps in
 * a fresh channel and refreshes immediately. The Supabase client and Next
 * router are faked; the channel fake exposes the handlers so tests can drive
 * broadcast and status events.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { REFRESH_DEBOUNCE_MS } from "@/lib/rollcall-realtime";

type StatusCb = (status: string) => void;
type BroadcastCb = (message: { payload: unknown }) => void;

interface FakeChannel {
  topic: string;
  onBroadcast?: BroadcastCb;
  onStatus?: StatusCb;
  on: (type: string, filter: unknown, cb: BroadcastCb) => FakeChannel;
  subscribe: (cb: StatusCb) => FakeChannel;
}

const h = vi.hoisted(() => ({
  channels: [] as FakeChannel[],
  removeChannel: vi.fn(),
  refresh: vi.fn(),
  router: { refresh: undefined as unknown as () => void },
}));
h.router.refresh = h.refresh;

// Next's useRouter() returns one stable instance; the mock must too, or the
// hook's effect would re-run (and reopen the channel) on every render.
vi.mock("next/navigation", () => ({ useRouter: () => h.router }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (topic: string): FakeChannel => {
      const fake: FakeChannel = {
        topic,
        on(_type, _filter, cb) {
          fake.onBroadcast = cb;
          return fake;
        },
        subscribe(cb) {
          fake.onStatus = cb;
          return fake;
        },
      };
      h.channels.push(fake);
      return fake;
    },
    removeChannel: h.removeChannel,
  }),
}));

import { useRollcallLive } from "@/lib/use-rollcall-live";

/** The most recently opened fake channel. */
function latest(): FakeChannel {
  return h.channels[h.channels.length - 1];
}

/** Sets document.visibilityState and fires the event the hook listens for. */
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  h.channels.length = 0;
  h.removeChannel.mockReset();
  h.refresh.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRollcallLive", () => {
  test("opens the session's channel and reports connected once subscribed", () => {
    const { result } = renderHook(() => useRollcallLive({ sessionId: "s1" }));
    expect(latest().topic).toBe("rollcall:session:s1");
    expect(result.current.connection).toBe("connecting");
    act(() => latest().onStatus?.("SUBSCRIBED"));
    expect(result.current.connection).toBe("connected");
  });

  test("opens no channel when disabled", () => {
    renderHook(() => useRollcallLive({ sessionId: "s1", enabled: false }));
    expect(h.channels).toHaveLength(0);
  });

  test("never refreshes on a timer: a healthy idle page makes zero requests", () => {
    renderHook(() => useRollcallLive({ sessionId: "s1" }));
    act(() => latest().onStatus?.("SUBSCRIBED"));
    act(() => vi.advanceTimersByTime(60 * 60 * 1000));
    expect(h.refresh).not.toHaveBeenCalled();
  });

  test("a broadcast passes the payload on at once, then refreshes once after the debounce", () => {
    const onVerified = vi.fn();
    renderHook(() => useRollcallLive({ sessionId: "s1", onVerified }));
    act(() => latest().onStatus?.("SUBSCRIBED"));

    act(() => latest().onBroadcast?.({ payload: { firstName: "Ada", lastName: "L" } }));
    expect(onVerified).toHaveBeenCalledWith({ firstName: "Ada", lastName: "L" });
    expect(h.refresh).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS));
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  test("a burst of check-ins coalesces into a single refresh", () => {
    renderHook(() => useRollcallLive({ sessionId: "s1" }));
    act(() => latest().onStatus?.("SUBSCRIBED"));
    for (const name of ["A", "B", "C", "D"]) {
      act(() => latest().onBroadcast?.({ payload: { firstName: name, lastName: "X" } }));
      act(() => vi.advanceTimersByTime(300));
    }
    act(() => vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS));
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  test("a malformed payload is not passed on but still triggers the reconciling refresh", () => {
    const onVerified = vi.fn();
    renderHook(() => useRollcallLive({ sessionId: "s1", onVerified }));
    act(() => latest().onBroadcast?.({ payload: {} }));
    act(() => vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS));
    expect(onVerified).not.toHaveBeenCalled();
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  test("the first connect does not refresh, but recovering from a drop does", () => {
    const { result } = renderHook(() => useRollcallLive({ sessionId: "s1" }));
    act(() => latest().onStatus?.("SUBSCRIBED"));
    act(() => vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS));
    expect(h.refresh).not.toHaveBeenCalled();

    act(() => latest().onStatus?.("CLOSED"));
    expect(result.current.connection).toBe("disconnected");
    act(() => latest().onStatus?.("SUBSCRIBED"));
    act(() => vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS));
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  test("reconnect swaps in a fresh channel and refreshes immediately", () => {
    const { result } = renderHook(() => useRollcallLive({ sessionId: "s1" }));
    const first = latest();
    act(() => first.onStatus?.("SUBSCRIBED"));

    act(() => result.current.reconnect());
    expect(h.removeChannel).toHaveBeenCalledWith(first);
    expect(h.channels).toHaveLength(2);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.connection).toBe("connecting");
  });

  test("the removed channel's final CLOSED does not clobber the new connection", () => {
    const { result } = renderHook(() => useRollcallLive({ sessionId: "s1" }));
    const first = latest();
    act(() => result.current.reconnect());
    act(() => latest().onStatus?.("SUBSCRIBED"));
    act(() => first.onStatus?.("CLOSED"));
    expect(result.current.connection).toBe("connected");
  });

  test("returning to a visible tab refreshes once when connected", () => {
    renderHook(() => useRollcallLive({ sessionId: "s1" }));
    act(() => latest().onStatus?.("SUBSCRIBED"));
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS));
    expect(h.refresh).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    act(() => vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS));
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  test("returning to a visible tab while disconnected resubscribes", () => {
    renderHook(() => useRollcallLive({ sessionId: "s1" }));
    act(() => latest().onStatus?.("CHANNEL_ERROR"));
    act(() => setVisibility("visible"));
    expect(h.channels).toHaveLength(2);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  test("unmount removes the channel and cancels a pending refresh", () => {
    const { unmount } = renderHook(() => useRollcallLive({ sessionId: "s1" }));
    const ch = latest();
    act(() => ch.onBroadcast?.({ payload: { firstName: "A", lastName: "B" } }));
    unmount();
    expect(h.removeChannel).toHaveBeenCalledWith(ch);
    act(() => vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 2));
    expect(h.refresh).not.toHaveBeenCalled();
  });
});
