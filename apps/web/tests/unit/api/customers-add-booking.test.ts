/**
 * Unit tests for POST /api/customers/[id]/add-booking
 * (app/api/customers/[id]/add-booking/route.ts)
 *
 * The property under test: a manager can add a student to a class that has
 * already started (status "in_progress" after Start Class), and still cannot
 * add one to a class that is cancelled, completed, or past its end time.
 *
 * External dependencies are mocked:
 *   @/lib/supabase/server     — admin client with a canned session + insert spy
 *   @/lib/auth/effective-role — role resolution
 *   @/lib/send-email          — emails disabled, so the route stops after the insert
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/customers/[id]/add-booking/route";

const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const CUSTOMER_ID = "44444444-4444-4444-4444-444444444444";

const insertSpy = vi.fn();
let sessionRow: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "class_sessions") {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: sessionRow }) }),
          }),
        };
      }
      return { insert: insertSpy };
    },
  })),
}));

vi.mock("@/lib/auth/effective-role", () => ({
  requireApiRole: vi.fn(async () => ({ actor: { user: { id: "manager-1" } } })),
}));

vi.mock("@/lib/send-email", () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: vi.fn(() => false),
}));

/** Floating wall-clock timestamps far from "now", so no test depends on the clock. */
const FUTURE = { starts_at: "2999-01-01T09:00:00", ends_at: "2999-01-01T17:00:00" };
const PAST = { starts_at: "2000-01-01T09:00:00", ends_at: "2000-01-01T17:00:00" };
/** Started long ago, ends far in the future: a class that is in progress. */
const UNDER_WAY = { starts_at: "2000-01-01T09:00:00", ends_at: "2999-01-01T17:00:00" };

/**
 * Builds a session row as the route's select would return it.
 * @param overrides - fields to replace on the default approved, scheduled, empty session
 */
function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SESSION_ID,
    max_capacity: 9,
    approval_status: "approved",
    status: "scheduled",
    ...FUTURE,
    instructor_id: "instr-1",
    bookings: [],
    ...overrides,
  };
}

/** Calls the route as a manager adding CUSTOMER_ID to SESSION_ID. */
async function addBooking(): Promise<Response> {
  const request = new Request("http://test/api/customers/x/add-booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: SESSION_ID, reason: "Walk-in" }),
  });
  return POST(request, { params: Promise.resolve({ id: CUSTOMER_ID }) });
}

describe("POST /api/customers/[id]/add-booking", () => {
  beforeEach(() => {
    insertSpy.mockReset();
    insertSpy.mockResolvedValue({ error: null });
    sessionRow = makeSession();
  });

  test("books a scheduled class that has not started", async () => {
    const res = await addBooking();
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  test("books a class that is already in progress", async () => {
    sessionRow = makeSession({ status: "in_progress", ...UNDER_WAY });
    const res = await addBooking();
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  test("books a still-scheduled class whose start time has passed", async () => {
    sessionRow = makeSession(UNDER_WAY);
    const res = await addBooking();
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  test("refuses a class that has ended", async () => {
    sessionRow = makeSession({ status: "in_progress", ...PAST });
    const res = await addBooking();
    expect(res.status).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test.each(["cancelled", "completed"])("refuses a %s class", async (status) => {
    sessionRow = makeSession({ status, ...UNDER_WAY });
    const res = await addBooking();
    expect(res.status).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test("refuses a full class even when it is in progress", async () => {
    sessionRow = makeSession({
      status: "in_progress",
      ...UNDER_WAY,
      max_capacity: 1,
      bookings: [{ id: "b1", cancelled: false }],
    });
    const res = await addBooking();
    expect(res.status).toBe(409);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
