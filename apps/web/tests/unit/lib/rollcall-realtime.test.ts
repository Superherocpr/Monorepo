/**
 * Unit tests for lib/rollcall-realtime.ts
 *
 * Covers: channel topic naming (must stay in sync between the broadcaster in
 * checkin-by-profile/route.ts and the listener in SessionDetailClient.tsx —
 * a typo in either would silently break live updates with no error), the
 * event name constant, and the pure live-update helpers (connection state
 * mapping, reconnect catch-up rule, trailing debounce).
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import {
  ROLLCALL_VERIFIED_EVENT,
  rollcallChannelTopic,
  connectionStateFromStatus,
  needsCatchUpRefresh,
  createTrailingDebounce,
} from "@/lib/rollcall-realtime";

describe("rollcallChannelTopic", () => {
  test("scopes the topic to the given session id", () => {
    expect(rollcallChannelTopic("abc-123")).toBe("rollcall:session:abc-123");
  });

  test("different session ids produce different topics", () => {
    expect(rollcallChannelTopic("session-a")).not.toBe(
      rollcallChannelTopic("session-b")
    );
  });
});

describe("ROLLCALL_VERIFIED_EVENT", () => {
  test("is a stable, non-empty string", () => {
    expect(typeof ROLLCALL_VERIFIED_EVENT).toBe("string");
    expect(ROLLCALL_VERIFIED_EVENT.length).toBeGreaterThan(0);
  });
});

describe("connectionStateFromStatus", () => {
  test("SUBSCRIBED is the only connected state", () => {
    expect(connectionStateFromStatus("SUBSCRIBED")).toBe("connected");
  });

  test.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])(
    "%s means broadcasts would be lost, so it is disconnected",
    (status) => {
      expect(connectionStateFromStatus(status)).toBe("disconnected");
    }
  );

  test("anything unrecognised is treated as still connecting", () => {
    expect(connectionStateFromStatus("JOINING")).toBe("connecting");
  });
});

describe("needsCatchUpRefresh", () => {
  test("recovering from disconnected requires a catch-up read", () => {
    expect(needsCatchUpRefresh("disconnected", "connected")).toBe(true);
  });

  test("the first connect of a page load does not", () => {
    expect(needsCatchUpRefresh("connecting", "connected")).toBe(false);
  });

  test("staying connected or going down does not", () => {
    expect(needsCatchUpRefresh("connected", "connected")).toBe(false);
    expect(needsCatchUpRefresh("connected", "disconnected")).toBe(false);
  });
});

describe("createTrailingDebounce", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a burst of calls runs once, after the quiet period", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createTrailingDebounce(fn, 1000);
    d.call();
    vi.advanceTimersByTime(600);
    d.call();
    vi.advanceTimersByTime(600);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("cancel drops a pending call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = createTrailingDebounce(fn, 1000);
    d.call();
    d.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
