/**
 * Unit tests for the earning selection on POST /api/payouts/create.
 *
 * The route moves money, so what matters is what each caller may ask for: an admin
 * may name specific earnings; automatic triggers may not; and a selection that is
 * empty or malformed must be refused rather than read as "pay everyone". The
 * reservation function's own behaviour is covered by the migration test.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/effective-role", () => ({ requireApiRole: vi.fn() }));
const submitMock = vi.fn();
vi.mock("@/lib/payout-submit", () => ({
  submitReservedPayout: (...args: unknown[]) => submitMock(...args),
}));
// The heartbeat wrapper only adds logging; the handler is what is under test.
vi.mock("@/lib/cron-heartbeat", () => ({
  isCronRequest: (request: Request) =>
    request.headers.get("Authorization") === "Bearer cron-secret",
  withCronHeartbeat: (_name: string, handler: unknown) => handler,
}));

import { POST } from "@/app/api/payouts/create/route";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

const rpcMock = vi.fn();

/** Reservation the stubbed RPC returns on success. */
const RESERVATION = {
  success: true,
  reserved_count: 2,
  batch: { id: "b1", sender_batch_id: "shcpr-1", total_amount: 40, item_count: 1 },
  items: [{ id: "i1", instructor_id: "a", recipient_email: "a@example.com", amount: 40 }],
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://superherocpr.com/api/payouts/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
    actor: { user: { id: "admin-1" } },
  });
  (createAdminClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    rpc: rpcMock,
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "admin-1" } }) }),
            }),
          }),
          maybeSingle: () => Promise.resolve({ data: { value: "manual" } }),
        }),
        in: () => Promise.resolve({ data: [] }),
      }),
    }),
  });
  rpcMock.mockResolvedValue({ data: RESERVATION, error: null });
  submitMock.mockResolvedValue({
    success: true,
    batchId: "b1",
    paypalBatchId: "PP-1",
    totalAmount: 40,
    itemCount: 1,
  });
});

describe("POST /api/payouts/create selection", () => {
  test("passes the chosen earnings to the reservation function", async () => {
    const res = await POST(post({ earningIds: [ID_A, ID_B] }));
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("reserve_instructor_payout_batch", {
      p_actor_id: "admin-1",
      p_earning_ids: [ID_A, ID_B],
    });
    const body = (await res.json()) as { requestedCount: number; reservedCount: number };
    expect(body.requestedCount).toBe(2);
    expect(body.reservedCount).toBe(2);
  });

  test("de-duplicates ids and normalises their case", async () => {
    await POST(post({ earningIds: [ID_A, ID_A.toUpperCase(), ID_B] }));
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_earning_ids: [ID_A, ID_B] });
  });

  test("with no selection it asks for every eligible earning and sends no id list", async () => {
    await POST(post({}));
    expect(rpcMock).toHaveBeenCalledWith("reserve_instructor_payout_batch", {
      p_actor_id: "admin-1",
    });
  });

  test("with no body at all it still pays everyone eligible, as before", async () => {
    const res = await POST(post(undefined));
    expect(res.status).toBe(200);
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_earning_ids");
  });

  test.each([
    ["an empty list", { earningIds: [] }],
    ["a non-array", { earningIds: ID_A }],
    ["a malformed id", { earningIds: [ID_A, "not-a-uuid"] }],
    ["a non-string id", { earningIds: [ID_A, 42] }],
    ["null", { earningIds: null }],
    ["too many ids", { earningIds: Array.from({ length: 1001 }, () => ID_A) }],
  ])("rejects %s and never reaches the database", async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(submitMock).not.toHaveBeenCalled();
  });

  test("an empty selection is refused, not treated as everyone", async () => {
    // The dangerous reading of [] is "no filter". It must be a 400 instead.
    const res = await POST(post({ earningIds: [] }));
    expect(res.status).toBe(400);
  });

  test("a non super_admin is refused before anything is parsed or reserved", async () => {
    (requireApiRole as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await POST(post({ earningIds: [ID_A] }));
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("an automatic trigger cannot narrow the batch", async () => {
    const res = await POST(
      post({ earningIds: [ID_A] }, { Authorization: "Bearer cron-secret", "X-Payout-Source": "immediate" })
    );
    expect(res.status).toBe(200);
    expect(rpcMock.mock.calls[0][1]).not.toHaveProperty("p_earning_ids");
  });

  test("explains when none of the selected earnings could be paid", async () => {
    rpcMock.mockResolvedValue({ data: { success: false, reason: "no_eligible_earnings" }, error: null });
    const res = await POST(post({ earningIds: [ID_A] }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/selected earnings/i);
  });

  test("reports when fewer earnings were reserved than requested", async () => {
    rpcMock.mockResolvedValue({ data: { ...RESERVATION, reserved_count: 1 }, error: null });
    const res = await POST(post({ earningIds: [ID_A, ID_B] }));
    const body = (await res.json()) as { requestedCount: number; reservedCount: number };
    expect(body.requestedCount).toBe(2);
    expect(body.reservedCount).toBe(1);
  });
});
