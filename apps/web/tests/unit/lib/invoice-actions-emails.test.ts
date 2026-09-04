/**
 * Unit tests for the emails sent by lib/invoice-actions.ts —
 * markInvoicePaidAndNotify.
 *
 * Two emails follow an invoice being paid: the instructor learns their money
 * landed, and the recipient gets the only customer-facing confirmation that
 * payment was received (which for group invoices also carries the roster-upload
 * link). Both are deliberately best-effort so a mail failure can never reverse
 * the paid status — which is exactly why a missing send would be invisible
 * without a test.
 *
 * This path is reachable two ways, manual mark-paid and a PayPal webhook, so
 * both sends are keyed on the invoice id: a webhook redelivery must not
 * double-notify anyone.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  sendEmails: vi.fn(),
  isEmailConfigured: () => true,
}));

vi.mock("@/lib/instructor-earnings", () => ({
  recordInvoiceEarning: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/payout-trigger", () => ({
  maybeTriggerImmediatePayout: vi.fn().mockResolvedValue(undefined),
}));

import { markInvoicePaidAndNotify } from "@/lib/invoice-actions";

const INVOICE_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_ID = "22222222-2222-2222-2222-222222222222";

/** A sent invoice joined with its instructor profile and class session. */
function invoiceRow(over: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    instructor_id: "33333333-3333-3333-3333-333333333333",
    invoice_number: "INV-1042",
    student_count: 8,
    invoice_type: "group",
    recipient_name: "Tampa General",
    recipient_email: "billing@tgh.example.com",
    status: "sent",
    total_amount: "600.00",
    class_session_id: "44444444-4444-4444-4444-444444444444",
    profiles: { email: "alex@example.com", first_name: "Alex", last_name: "Lee" },
    class_sessions: {
      starts_at: "2026-10-01T14:00:00",
      class_types: { name: "BLS Provider" },
    },
    ...over,
  };
}

/** Builds an admin client whose invoice read returns `invoice`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockClient(invoice: Record<string, unknown> | null): any {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.single = vi.fn(() => Promise.resolve({ data: invoice, error: null }));
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: invoice, error: null }).then(resolve);

  return {
    from: vi.fn(() => chain),
    rpc: vi.fn().mockResolvedValue({
      data: { paid_at: "2026-09-04T10:00:00Z" },
      error: null,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
});

describe("markInvoicePaidAndNotify", () => {
  test("emails both the instructor and the invoice recipient", async () => {
    const result = await markInvoicePaidAndNotify(mockClient(invoiceRow()), {
      invoiceId: INVOICE_ID,
      actorId: ACTOR_ID,
      source: "manual",
    });

    expect(result.success).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);

    const calls = sendEmailMock.mock.calls.map(
      (c) => c[0] as { context: string; to: string; idempotencyKey: string; html: string }
    );
    expect(calls.map((c) => c.context)).toEqual([
      "invoice-actions:instructor-paid",
      "invoice-actions:customer-paid",
    ]);
    expect(calls[0].to).toBe("alex@example.com");
    expect(calls[1].to).toBe("billing@tgh.example.com");

    // Keyed on the invoice so a PayPal webhook redelivery cannot double-notify.
    expect(calls[0].idempotencyKey).toBe(`invoice-paid-instructor-${INVOICE_ID}`);
    expect(calls[1].idempotencyKey).toBe(`invoice-paid-customer-${INVOICE_ID}`);
  });

  test("sends the same emails when the trigger is a PayPal webhook", async () => {
    await markInvoicePaidAndNotify(mockClient(invoiceRow()), {
      invoiceId: INVOICE_ID,
      actorId: ACTOR_ID,
      source: "webhook",
    });

    // Manual and webhook paths must behave identically — that is the whole
    // reason this logic was pulled into a shared helper.
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  test("still notifies the recipient when the instructor has no email", async () => {
    await markInvoicePaidAndNotify(
      mockClient(invoiceRow({ profiles: { email: null, first_name: "Alex", last_name: "Lee" } })),
      { invoiceId: INVOICE_ID, actorId: ACTOR_ID, source: "manual" }
    );

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect((sendEmailMock.mock.calls[0][0] as { context: string }).context).toBe(
      "invoice-actions:customer-paid"
    );
  });

  test("still notifies the instructor when the invoice has no recipient email", async () => {
    await markInvoicePaidAndNotify(mockClient(invoiceRow({ recipient_email: null })), {
      invoiceId: INVOICE_ID,
      actorId: ACTOR_ID,
      source: "manual",
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect((sendEmailMock.mock.calls[0][0] as { context: string }).context).toBe(
      "invoice-actions:instructor-paid"
    );
  });

  test("sends nothing when the invoice does not exist", async () => {
    const result = await markInvoicePaidAndNotify(mockClient(null), {
      invoiceId: INVOICE_ID,
      actorId: ACTOR_ID,
      source: "manual",
    });

    expect(result.success).toBe(false);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sends nothing when the invoice was already paid", async () => {
    const result = await markInvoicePaidAndNotify(mockClient(invoiceRow({ status: "paid" })), {
      invoiceId: INVOICE_ID,
      actorId: ACTOR_ID,
      source: "manual",
    });

    // Re-marking a paid invoice must not re-announce the payment.
    expect(result.success).toBe(false);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
