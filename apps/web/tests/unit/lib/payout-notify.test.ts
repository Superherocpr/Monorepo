/**
 * Unit tests for lib/payout-notify.ts — the three payout emails.
 *
 * These matter more than most. PayPal denies a payout batch asynchronously and
 * reports the reason only by email and in its own dashboard, so if this alert
 * does not fire, returned money sits unnoticed indefinitely and instructors go
 * unpaid with nobody aware. There is no screen in the app that would surface
 * it on its own.
 *
 * Each of the three functions swallows its own errors by design (a failed
 * alert must never fail the payout run), which is exactly why the send needs a
 * test — a silent no-op and a successful send look identical from the caller.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  sendEmails: vi.fn(),
  isEmailConfigured: () => true,
}));

import {
  notifyPayoutDenied,
  notifyPayoutIssuesDigest,
  notifyInstructorsPaid,
} from "@/lib/payout-notify";

const BATCH_ID = "11111111-1111-1111-1111-111111111111";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.eq = vi.fn(self);
  c.in = vi.fn(self);
  c.order = vi.fn(self);
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

/** Builds a client whose `.from(table)` returns the canned row set per table. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockClient(byTable: Record<string, { data: unknown; error: unknown }>): any {
  return {
    from: vi.fn((table: string) => {
      const result = byTable[table];
      if (!result) throw new Error(`Unexpected table: ${table}`);
      return chain(result);
    }),
  };
}

const ADMINS = { data: [{ email: "boss@superherocpr.com" }], error: null };

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
});

describe("notifyPayoutDenied", () => {
  test("alerts every active super_admin that PayPal denied a batch", async () => {
    const client = mockClient({
      instructor_payout_batches: {
        data: {
          sender_batch_id: "SB-1",
          paypal_payout_batch_id: "PP-1",
          total_amount: "450.00",
          item_count: 3,
        },
        error: null,
      },
      profiles: ADMINS,
    });

    await notifyPayoutDenied(client, BATCH_ID, "DENIED");

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string[];
      subject: string;
      html: string;
      idempotencyKey: string;
    };
    expect(call.context).toBe("payout-notify:denial");
    expect(call.to).toEqual(["boss@superherocpr.com"]);
    expect(call.subject).toContain("Action needed");
    // total_amount arrives from Postgres as a string; it must still format.
    expect(call.html).toContain("450");
    expect(call.idempotencyKey).toBe(`payout-denied-${BATCH_ID}`);
  });

  test("sends nothing when there are no active super_admins to tell", async () => {
    const client = mockClient({
      instructor_payout_batches: {
        data: {
          sender_batch_id: "SB-1",
          paypal_payout_batch_id: null,
          total_amount: 450,
          item_count: 3,
        },
        error: null,
      },
      profiles: { data: [], error: null },
    });

    await notifyPayoutDenied(client, BATCH_ID, "DENIED");

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sends nothing when the batch row cannot be read", async () => {
    const client = mockClient({
      instructor_payout_batches: { data: null, error: null },
      profiles: ADMINS,
    });

    await notifyPayoutDenied(client, BATCH_ID, "DENIED");

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("notifyPayoutIssuesDigest", () => {
  test("sends one digest covering the stuck batches", async () => {
    const client = mockClient({
      instructor_payout_batches: {
        data: [
          {
            id: BATCH_ID,
            sender_batch_id: "SB-1",
            status: "denied",
            total_amount: "450.00",
            item_count: 3,
            created_at: "2026-09-01T10:00:00Z",
            denial_reason: "Receiver account restricted",
          },
        ],
        error: null,
      },
      profiles: ADMINS,
    });

    await notifyPayoutIssuesDigest(client, [BATCH_ID]);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as { context: string; to: string[] };
    expect(call.context).toBe("payout-notify:stuck-digest");
    expect(call.to).toEqual(["boss@superherocpr.com"]);
  });

  test("does nothing when given no batch ids", async () => {
    await notifyPayoutIssuesDigest(mockClient({}), []);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("notifyInstructorsPaid", () => {
  test("emails each instructor whose payout item was sent", async () => {
    const client = mockClient({
      instructor_payout_items: {
        data: [
          {
            id: "item-1",
            amount: "150.00",
            recipient_email: "alex.paypal@example.com",
            profiles: { first_name: "Alex", email: "alex@example.com" },
          },
          {
            id: "item-2",
            amount: "90.00",
            recipient_email: "jamie.paypal@example.com",
            profiles: { first_name: "Jamie", email: "jamie@example.com" },
          },
        ],
        error: null,
      },
    });

    await notifyInstructorsPaid(client, ["item-1", "item-2"]);

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const calls = sendEmailMock.mock.calls.map(
      (c) => c[0] as { to: string; context: string; idempotencyKey: string }
    );
    expect(calls.map((c) => c.to)).toEqual(["alex@example.com", "jamie@example.com"]);
    expect(new Set(calls.map((c) => c.context))).toEqual(
      new Set(["payout-notify:instructor-paid"])
    );
    // Keyed per item so re-running reconciliation cannot tell an instructor
    // twice that the same payout went out.
    expect(calls.map((c) => c.idempotencyKey)).toEqual([
      "payout-sent-item-1",
      "payout-sent-item-2",
    ]);
  });

  test("skips an item whose instructor profile has no email, without dropping the rest", async () => {
    const client = mockClient({
      instructor_payout_items: {
        data: [
          {
            id: "item-1",
            amount: 150,
            recipient_email: "a@example.com",
            profiles: { first_name: "Alex", email: null },
          },
          {
            id: "item-2",
            amount: 90,
            recipient_email: "j@example.com",
            profiles: { first_name: "Jamie", email: "jamie@example.com" },
          },
        ],
        error: null,
      },
    });

    await notifyInstructorsPaid(client, ["item-1", "item-2"]);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect((sendEmailMock.mock.calls[0][0] as { to: string }).to).toBe("jamie@example.com");
  });

  test("does nothing when given no item ids", async () => {
    await notifyInstructorsPaid(mockClient({}), []);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
