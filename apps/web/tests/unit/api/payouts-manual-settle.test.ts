/**
 * Unit tests for POST /api/payouts/manual-settle and /api/payouts/manual-void.
 *
 * Recording a manual payout flips earnings to `paid`, so the route has to refuse
 * every case where that would be wrong: not a super_admin, no typed
 * confirmation, PayPal still moving or already delivering the money, or the RPC
 * refusing. It also has to actually tell the instructor on success. The RPC's own
 * behaviour is covered by the migration test; here it is a stub.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { POST as settle } from "@/app/api/payouts/manual-settle/route";
import { POST as voidManual } from "@/app/api/payouts/manual-void/route";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/auth/effective-role", () => ({
  requireApiRole: vi.fn(),
}));
const getStatusMock = vi.fn();
vi.mock("@/lib/paypal-payouts", () => ({
  getPayPalPayoutBatchStatus: (...args: unknown[]) => getStatusMock(...args),
}));
const notifyMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/payout-notify", () => ({
  notifyInstructorManualPayout: (...args: unknown[]) => notifyMock(...args),
}));

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const BATCH_ROW = { id: "batch-1", sender_batch_id: "shcpr-abc", paypal_payout_batch_id: "PP-1" };

function post(url: string, payload: unknown): Request {
  return new Request(`https://superherocpr.com${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function settleBody(over: Record<string, unknown> = {}) {
  return {
    batchId: "batch-1",
    itemId: "item-1",
    method: "zelle",
    reference: "ZEL-4471",
    paidOn: "2026-10-05",
    amount: "125.50",
    note: "",
    confirmSenderBatchId: "shcpr-abc",
    ...over,
  };
}

const rpcMock = vi.fn();

function livePayPal(transactionStatus: string) {
  getStatusMock.mockResolvedValue({
    batchStatus: "SUCCESS",
    feeTotal: null,
    items: [{ senderItemId: "item-1", transactionStatus }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: { user: { id: "admin-1" } },
  });
  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: BATCH_ROW }) }) }),
    }),
    rpc: rpcMock,
  });
  rpcMock.mockResolvedValue({ data: { success: true }, error: null });
  livePayPal("DENIED");
});

describe("POST /api/payouts/manual-settle", () => {
  test("returns the auth error and does nothing for a non super_admin", async () => {
    (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await settle(post("/api/payouts/manual-settle", settleBody()));
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("rejects an invalid body before touching anything", async () => {
    const res = await settle(post("/api/payouts/manual-settle", settleBody({ method: "bitcoin" })));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("rejects a wrong typed confirmation", async () => {
    const res = await settle(
      post("/api/payouts/manual-settle", settleBody({ confirmSenderBatchId: "shcpr-nope" }))
    );
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test.each(["SUCCESS", "PENDING", "UNCLAIMED", "ONHOLD"])(
    "refuses when PayPal reports the item as %s",
    async (status) => {
      livePayPal(status);
      const res = await settle(post("/api/payouts/manual-settle", settleBody()));
      expect(res.status).toBe(409);
      expect(rpcMock).not.toHaveBeenCalled();
      expect(notifyMock).not.toHaveBeenCalled();
    }
  );

  test("proceeds when PayPal reports the item as denied", async () => {
    livePayPal("DENIED");
    const res = await settle(post("/api/payouts/manual-settle", settleBody()));
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith(
      "record_manual_payout_item",
      expect.objectContaining({
        p_actor_id: "admin-1",
        p_batch_id: "batch-1",
        p_item_id: "item-1",
        p_method: "zelle",
        p_reference: "ZEL-4471",
        p_paid_on: "2026-10-05",
        p_amount: 125.5,
      })
    );
  });

  test("an unreachable PayPal does not block recovery", async () => {
    getStatusMock.mockRejectedValue(new Error("network down"));
    const res = await settle(post("/api/payouts/manual-settle", settleBody()));
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalled();
  });

  test("emails the instructor exactly once on success", async () => {
    const res = await settle(post("/api/payouts/manual-settle", settleBody()));
    expect(res.status).toBe(200);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][1]).toBe("item-1");
  });

  test("maps an RPC refusal to its message and sends no email", async () => {
    rpcMock.mockResolvedValue({
      data: { success: false, reason: "earnings_changed" },
      error: null,
    });
    const res = await settle(post("/api/payouts/manual-settle", settleBody()));
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/twice/);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  test("a database error returns a generic 500 without leaking details", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "relation secret_table failed" } });
    const res = await settle(post("/api/payouts/manual-settle", settleBody()));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("secret_table");
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/payouts/manual-void", () => {
  test("requires a reason", async () => {
    const res = await voidManual(post("/api/payouts/manual-void", { itemId: "item-1" }));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("calls the void RPC with the acting admin", async () => {
    const res = await voidManual(
      post("/api/payouts/manual-void", { itemId: "item-1", reason: "Never actually sent" })
    );
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("void_manual_payout_item", {
      p_actor_id: "admin-1",
      p_item_id: "item-1",
      p_reason: "Never actually sent",
    });
  });

  test("returns the RPC refusal when the item is not manually paid", async () => {
    rpcMock.mockResolvedValue({ data: { success: false, reason: "not_manually_paid" }, error: null });
    const res = await voidManual(
      post("/api/payouts/manual-void", { itemId: "item-1", reason: "oops" })
    );
    expect(res.status).toBe(409);
  });

  test("returns the auth error for a non super_admin", async () => {
    (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await voidManual(
      post("/api/payouts/manual-void", { itemId: "item-1", reason: "oops" })
    );
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
