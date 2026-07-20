/**
 * Unit tests for lib/rollcall-realtime.ts
 *
 * Covers: channel topic naming (must stay in sync between the broadcaster in
 * checkin-by-profile/route.ts and the listener in SessionDetailClient.tsx —
 * a typo in either would silently break live updates with no error) and the
 * event name constant.
 */
import { describe, test, expect } from "vitest";
import {
  ROLLCALL_VERIFIED_EVENT,
  rollcallChannelTopic,
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
