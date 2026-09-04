/**
 * Send tests for two customer-facing emails that had no coverage:
 *
 *   POST /api/account/archive      — "your account has been deleted"
 *   POST /api/orders/mark-shipped  — "your order has shipped", with tracking
 *
 * Both are deliberately non-fatal: the archive and the shipped status are
 * already committed by the time the email is attempted, so neither route
 * reports a mail failure to the caller. That is the right behaviour and also
 * precisely why a dropped send here would never be noticed — the customer
 * simply never hears that their account is gone, or never gets their tracking
 * number.
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

import { POST as archivePOST } from "@/app/api/account/archive/route";
import { POST as markShippedPOST } from "@/app/api/orders/mark-shipped/route";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const ORDER_ID = "22222222-2222-2222-2222-222222222222";

/** A minimal chainable Supabase query builder mock resolving to `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = vi.fn(self);
  c.update = vi.fn(self);
  c.eq = vi.fn(self);
  c.single = vi.fn(() => Promise.resolve(result));
  c.maybeSingle = vi.fn(() => Promise.resolve(result));
  c.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue({ sent: true, id: "email-1" });
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: { user: { id: USER_ID }, profile: {}, effectiveRole: "super_admin" },
  });
});

describe("POST /api/account/archive", () => {
  /** Signed-in client whose profile read returns `profile`. */
  function mockSignedIn(profile: unknown, updateError: unknown = null) {
    let call = 0;
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from: vi.fn(() => {
        call += 1;
        // 1st: the profile read. 2nd: the archiving update.
        return call === 1
          ? chain({ data: profile, error: null })
          : chain({ data: null, error: updateError });
      }),
    });
  }

  test("emails the customer confirming the deletion", async () => {
    mockSignedIn({ first_name: "Dana", email: "dana@example.com" });

    const res = await archivePOST();

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string;
      subject: string;
    };
    expect(call.context).toBe("account/archive");
    expect(call.to).toBe("dana@example.com");
    expect(call.subject).toContain("deleted");
  });

  test("sends nothing when the archive write fails", async () => {
    mockSignedIn({ first_name: "Dana", email: "dana@example.com" }, { message: "db down" });

    const res = await archivePOST();

    // Telling someone their account was deleted when it was not is worse than
    // saying nothing.
    expect(res.status).toBe(500);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sends nothing when the caller is not signed in", async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
    });

    const res = await archivePOST();

    expect(res.status).toBe(401);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/orders/mark-shipped", () => {
  const PAID_ORDER = {
    id: ORDER_ID,
    status: "paid",
    total_amount: 49.98,
    shipping_name: "Dana Scully",
    shipping_city: "Tampa",
    shipping_state: "FL",
    profiles: { first_name: "Dana", email: "dana@example.com" },
    order_items: [
      {
        quantity: 2,
        price_at_purchase: 24.99,
        product_variants: { size: "L", products: { name: "Hero Tee" } },
      },
    ],
  };

  function mockOrder(order: unknown, updateError: unknown = null) {
    let call = 0;
    (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn(() => {
        call += 1;
        // 1st: the order read. 2nd: the shipped-status update.
        return call === 1
          ? chain({ data: order, error: null })
          : chain({ data: null, error: updateError });
      }),
    });
  }

  function shipRequest(body: Record<string, unknown>): Request {
    return new Request("https://superherocpr.com/api/orders/mark-shipped", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("emails the customer their tracking number and order contents", async () => {
    mockOrder(PAID_ORDER);

    const res = await markShippedPOST(
      shipRequest({ orderId: ORDER_ID, trackingNumber: " 1Z999AA10123456784 ", carrier: "UPS" })
    );

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const call = sendEmailMock.mock.calls[0][0] as {
      context: string;
      to: string;
      html: string;
    };
    expect(call.context).toBe("orders/mark-shipped");
    expect(call.to).toBe("dana@example.com");
    // Tracking is the entire reason the customer opens this email.
    expect(call.html).toContain("1Z999AA10123456784");
    expect(call.html).toContain("UPS");
    expect(call.html).toContain("Hero Tee");
  });

  test("omits the carrier line when none was supplied", async () => {
    mockOrder(PAID_ORDER);

    await markShippedPOST(
      shipRequest({ orderId: ORDER_ID, trackingNumber: "1Z999AA10123456784" })
    );

    const call = sendEmailMock.mock.calls[0][0] as { html: string };
    expect(call.html).not.toContain("Carrier:");
  });

  test("sends nothing when the order was not paid", async () => {
    mockOrder({ ...PAID_ORDER, status: "pending" });

    const res = await markShippedPOST(
      shipRequest({ orderId: ORDER_ID, trackingNumber: "1Z999AA10123456784" })
    );

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sends nothing when the tracking number is missing", async () => {
    mockOrder(PAID_ORDER);

    const res = await markShippedPOST(shipRequest({ orderId: ORDER_ID, trackingNumber: "  " }));

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sends nothing when the status update fails", async () => {
    mockOrder(PAID_ORDER, { message: "db down" });

    const res = await markShippedPOST(
      shipRequest({ orderId: ORDER_ID, trackingNumber: "1Z999AA10123456784" })
    );

    expect(res.status).toBe(500);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
