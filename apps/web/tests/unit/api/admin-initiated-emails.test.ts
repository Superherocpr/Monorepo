/**
 * Send tests for two staff-initiated emails.
 *
 *   POST /api/customers/create  — admin creates a customer account
 *   POST /api/invoices/resend   — instructor re-sends an invoice
 *
 * Both share a property worth pinning: the staff member who clicked needs to
 * know whether the mail actually went out, because they are the only one who
 * can retry. A customer created without a setup email cannot sign in at all
 * (the temp password is a random UUID nobody is told), and an invoice nobody
 * receives is money that never gets collected.
 *
 * So neither route may report a bare success — customers/create returns an
 * `emailSent` flag, and invoices/resend writes the delivery failure into the
 * invoice activity log, which is what an admin reads when a customer says the
 * invoice never arrived.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue({ sent: true, id: "email-1" });
vi.mock("@/lib/send-email", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
  sendEmails: vi.fn(),
  isEmailConfigured: () => true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/effective-role", () => ({ requireApiRole: vi.fn() }));

import { POST as createCustomerPOST } from "@/app/api/customers/create/route";
import { POST as resendInvoicePOST } from "@/app/api/invoices/resend/route";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const NEW_USER_ID = "22222222-2222-2222-2222-222222222222";
const INVOICE_ID = "33333333-3333-3333-3333-333333333333";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  for (const m of ["select", "insert", "update", "eq", "in", "order"]) c[m] = vi.fn(self);
  c.single = vi.fn(() => Promise.resolve(result));
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: { user: { id: ACTOR_ID }, profile: {}, effectiveRole: "super_admin" },
  });
});

describe("POST /api/customers/create", () => {
  /** Admin client for the create flow; `setupLink` null simulates link failure. */
  function mockCreate(setupLink: string | null = "https://setup.link") {
    (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn(() => chain({ data: null, error: null })),
      auth: {
        admin: {
          createUser: vi
            .fn()
            .mockResolvedValue({ data: { user: { id: NEW_USER_ID } }, error: null }),
          deleteUser: vi.fn().mockResolvedValue({}),
          generateLink: vi.fn().mockResolvedValue({
            data: setupLink ? { properties: { action_link: setupLink } } : null,
            error: null,
          }),
        },
      },
    });
  }

  const validBody = {
    firstName: "Dana",
    lastName: "Scully",
    email: "Dana@Example.com",
    phone: "(813) 555-0100",
  };

  test("emails the new customer their setup link and reports emailSent", async () => {
    mockCreate();

    const res = await createCustomerPOST(
      jsonRequest("https://superherocpr.com/api/customers/create", validBody)
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, emailSent: true });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string;
      html: string;
    };
    expect(call.context).toBe("customers/create:setup");
    expect(call.to).toBe("dana@example.com");
    expect(call.html).toContain("https://setup.link");
  });

  test("reports emailSent:false so the admin knows the customer cannot sign in", async () => {
    mockCreate();
    sendEmailMock.mockResolvedValue({ sent: false, reason: "failed", error: "boom" });

    const res = await createCustomerPOST(
      jsonRequest("https://superherocpr.com/api/customers/create", validBody)
    );

    // The account exists but is unreachable without the link — the admin has to
    // be told, or nobody ever finds out.
    expect(await res.json()).toMatchObject({ success: true, emailSent: false });
  });

  test("reports emailSent:false when no setup link could be generated", async () => {
    mockCreate(null);

    const res = await createCustomerPOST(
      jsonRequest("https://superherocpr.com/api/customers/create", validBody)
    );

    expect(await res.json()).toMatchObject({ emailSent: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sends nothing when validation rejects the request", async () => {
    mockCreate();

    const res = await createCustomerPOST(
      jsonRequest("https://superherocpr.com/api/customers/create", { ...validBody, phone: "" })
    );

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/invoices/resend", () => {
  /** Captures invoice_activity_log inserts so the failure note is assertable. */
  let loggedNotes: string[] = [];

  function mockInvoice(invoice: unknown) {
    loggedNotes = [];
    (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn((table: string) => {
        const c = chain({ data: invoice, error: null });
        if (table === "invoice_activity_log") {
          c.insert = vi.fn((row: Record<string, unknown>) => {
            if (typeof row.notes === "string") loggedNotes.push(row.notes);
            return c;
          });
        }
        return c;
      }),
    });
  }

  const SENT_INVOICE = {
    id: INVOICE_ID,
    instructor_id: ACTOR_ID,
    invoice_number: "INV-1042",
    invoice_type: "group",
    recipient_name: "Tampa General",
    recipient_email: "billing@tgh.example.com",
    company_name: "Tampa General",
    student_count: 8,
    total_amount: 600,
    payment_platform: "PayPal",
    platform_invoice_id: "PP-1",
    status: "sent",
    notes: "Net 30.",
    class_sessions: {
      starts_at: "2026-10-01T14:00:00",
      class_types: { name: "BLS Provider" },
      locations: { name: "HQ", city: "Tampa", state: "FL" },
    },
  };

  test("re-sends the invoice to the corrected address", async () => {
    mockInvoice(SENT_INVOICE);

    const res = await resendInvoicePOST(
      jsonRequest("https://superherocpr.com/api/invoices/resend", {
        invoiceId: INVOICE_ID,
        newEmail: "ap@tgh.example.com",
      })
    );

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string;
      html: string;
    };
    expect(call.context).toBe("invoices/resend");
    // The whole point of a resend is reaching the corrected address.
    expect(call.to).toBe("ap@tgh.example.com");
    expect(call.html).toContain("INV-1042");
  });

  test("records the delivery failure in the activity log", async () => {
    mockInvoice(SENT_INVOICE);
    sendEmailMock.mockResolvedValue({ sent: false, reason: "failed", error: "mailbox full" });

    await resendInvoicePOST(
      jsonRequest("https://superherocpr.com/api/invoices/resend", {
        invoiceId: INVOICE_ID,
        newEmail: "ap@tgh.example.com",
      })
    );

    // This note is what an admin reads when the customer says it never arrived.
    expect(loggedNotes.some((n) => n.includes("email delivery failed: mailbox full"))).toBe(
      true
    );
  });

  test("sends nothing for a malformed address", async () => {
    mockInvoice(SENT_INVOICE);

    const res = await resendInvoicePOST(
      jsonRequest("https://superherocpr.com/api/invoices/resend", {
        invoiceId: INVOICE_ID,
        newEmail: "not-an-email",
      })
    );

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
