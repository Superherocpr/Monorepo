/**
 * Unit tests for lib/assistant-reminder.ts — maybeSendAssistantReminder.
 *
 * BLS/ACLS classes need a second pair of hands once paid enrollment reaches 9.
 * Nothing in the app watches enrollment on a schedule; this helper runs after
 * each booking, and the email it sends is the only notice the instructor gets.
 * So the tests here are about exactly one question: does the email go out, and
 * does it go out exactly once?
 *
 * The "exactly once" part is enforced by a conditional UPDATE that stamps
 * assistant_reminder_sent_at only when it is still null — whichever concurrent
 * booking wins that update is the one that emails. A test covers the loser.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  sendEmails: vi.fn(),
  isEmailConfigured: () => true,
}));

import { maybeSendAssistantReminder } from "@/lib/assistant-reminder";
import type { SupabaseClient } from "@supabase/supabase-js";

const SESSION_ID = "11111111-1111-1111-1111-111111111111";
const INSTRUCTOR_ID = "22222222-2222-2222-2222-222222222222";
const BASE_URL = "https://superherocpr.com";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.update = vi.fn(self);
  c.eq = vi.fn(self);
  c.is = vi.fn(self);
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

/** A session row at the assistant threshold, on a class type that requires one. */
function sessionRow(over: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    starts_at: "2026-10-01T14:00:00",
    instructor_id: INSTRUCTOR_ID,
    assistant_instructor_id: null,
    assistant_name: null,
    assistant_reminder_sent_at: null,
    class_types: { name: "BLS Provider", requires_assistant_at_capacity: true },
    bookings: Array.from({ length: 9 }, () => ({ cancelled: false })),
    ...over,
  };
}

/**
 * Builds a Supabase mock for this helper's three queries, in call order:
 * the session read, the conditional claim update, then the instructor lookup.
 */
function mockClient(opts: {
  session?: Record<string, unknown> | null;
  claimed?: { id: string }[] | null;
  instructor?: { first_name: string; last_name: string; email: string | null } | null;
}) {
  const {
    session = sessionRow(),
    claimed = [{ id: SESSION_ID }],
    instructor = { first_name: "Alex", last_name: "Lee", email: "alex@example.com" },
  } = opts;

  let sessionCalls = 0;
  const from = vi.fn((table: string) => {
    if (table === "class_sessions") {
      sessionCalls += 1;
      // 1st: the read. 2nd: the conditional claim update.
      return sessionCalls === 1
        ? chain({ data: session, error: null })
        : chain({ data: claimed, error: null });
    }
    if (table === "profiles") return chain({ data: instructor, error: null });
    throw new Error(`Unexpected table: ${table}`);
  });

  return { from } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
});

describe("maybeSendAssistantReminder", () => {
  test("emails the instructor when enrollment reaches the threshold", async () => {
    await maybeSendAssistantReminder(mockClient({}), SESSION_ID, BASE_URL);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string;
      subject: string;
      html: string;
      idempotencyKey: string;
    };
    expect(call.context).toBe("assistant-reminder");
    expect(call.to).toBe("alex@example.com");
    expect(call.subject).toContain("Assistant needed");
    expect(call.html).toContain("BLS Provider");
    expect(call.idempotencyKey).toBe(`assistant-reminder-${SESSION_ID}`);
  });

  test("does not email below the threshold", async () => {
    const session = sessionRow({
      bookings: Array.from({ length: 8 }, () => ({ cancelled: false })),
    });

    await maybeSendAssistantReminder(mockClient({ session }), SESSION_ID, BASE_URL);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("ignores cancelled bookings when counting toward the threshold", async () => {
    // 9 rows, but one is cancelled — that is 8 paid students, not 9.
    const bookings = [
      ...Array.from({ length: 8 }, () => ({ cancelled: false })),
      { cancelled: true },
    ];

    await maybeSendAssistantReminder(
      mockClient({ session: sessionRow({ bookings }) }),
      SESSION_ID,
      BASE_URL
    );

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("does not email when the class type does not require an assistant", async () => {
    const session = sessionRow({
      class_types: { name: "Heartsaver First Aid", requires_assistant_at_capacity: false },
    });

    await maybeSendAssistantReminder(mockClient({ session }), SESSION_ID, BASE_URL);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("does not email when an assistant is already assigned", async () => {
    const session = sessionRow({ assistant_name: "Jamie Helper" });

    await maybeSendAssistantReminder(mockClient({ session }), SESSION_ID, BASE_URL);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("does not email twice — the reminder was already sent", async () => {
    const session = sessionRow({ assistant_reminder_sent_at: "2026-09-01T10:00:00Z" });

    await maybeSendAssistantReminder(mockClient({ session }), SESSION_ID, BASE_URL);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("the request that loses the claim race does not send a second email", async () => {
    // The conditional update matched no rows: another concurrent booking got
    // there first and is the one sending.
    await maybeSendAssistantReminder(mockClient({ claimed: [] }), SESSION_ID, BASE_URL);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("does not send when the instructor has no email on file", async () => {
    await maybeSendAssistantReminder(
      mockClient({ instructor: { first_name: "Alex", last_name: "Lee", email: null } }),
      SESSION_ID,
      BASE_URL
    );

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
