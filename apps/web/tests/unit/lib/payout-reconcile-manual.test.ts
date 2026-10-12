/**
 * Tests that PayPal reconciliation never overwrites a payout an admin settled by
 * hand (migration 0075).
 *
 * PayPal has been denying batches, and an admin then pays instructors directly.
 * The hourly sync, the payouts webhook and the deny route all funnel through
 * lib/payout-reconcile.ts; if any of them flipped a manually_paid item back to
 * denied, its earnings would read as unpaid again and the instructor could be
 * paid a second time. These run reconcilePayoutBatch / denyPayoutBatchLocally
 * against a small in-memory stand-in for the Supabase client.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const getStatusMock = vi.fn();
vi.mock("@/lib/paypal-payouts", () => ({
  getPayPalPayoutBatchStatus: (...args: unknown[]) => getStatusMock(...args),
}));

import { denyPayoutBatchLocally, reconcilePayoutBatch } from "@/lib/payout-reconcile";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** Chainable query over an in-memory table: select / update with eq, neq, in filters. */
function makeQuery(tables: Tables, name: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let patch: Row | null = null;
  const query: Record<string, unknown> = {};
  const exec = (): { data: Row[]; error: null } => {
    const matched = (tables[name] ?? []).filter((row) => filters.every((f) => f(row)));
    if (patch) for (const row of matched) Object.assign(row, patch);
    return { data: matched.map((row) => ({ ...row })), error: null };
  };
  query.select = () => query;
  query.update = (p: Row) => {
    patch = p;
    return query;
  };
  query.eq = (col: string, value: unknown) => {
    filters.push((row) => row[col] === value);
    return query;
  };
  query.neq = (col: string, value: unknown) => {
    filters.push((row) => row[col] !== value);
    return query;
  };
  query.in = (col: string, values: unknown[]) => {
    filters.push((row) => values.includes(row[col]));
    return query;
  };
  query.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
    Promise.resolve(exec()).then(resolve);
  return query;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeClient(tables: Tables): any {
  return { from: (name: string) => makeQuery(tables, name) };
}

const BATCH = "batch-1";

/** Builds a batch whose items are given as { id, status, earningStatus }. */
function buildTables(items: Array<{ id: string; status: string; earning: string }>): Tables {
  return {
    instructor_payout_batches: [{ id: BATCH, status: "assumed_complete", error_message: null }],
    instructor_payout_items: items.map((i) => ({
      id: i.id,
      payout_batch_id: BATCH,
      status: i.status,
      error_message: null,
    })),
    instructor_earnings: items.map((i) => ({
      id: `earning-${i.id}`,
      payout_item_id: i.id,
      status: i.earning,
    })),
    instructor_payout_attempts: items.map((i) => ({
      id: `attempt-${i.id}`,
      payout_batch_id: BATCH,
      payout_item_id: i.id,
      outcome: i.status === "manually_paid" ? "manually_paid" : "submitted",
    })),
  };
}

const find = (tables: Tables, table: string, id: string): Row =>
  tables[table].find((row) => row.id === id) as Row;

function paypalReports(batchStatus: string, itemStatuses: Record<string, string>) {
  getStatusMock.mockResolvedValue({
    batchStatus,
    feeTotal: null,
    items: Object.entries(itemStatuses).map(([senderItemId, transactionStatus]) => ({
      senderItemId,
      transactionStatus,
      payoutItemId: `pp-${senderItemId}`,
      errorMessage: null,
      feeAmount: null,
      timeProcessed: null,
    })),
  });
}

const ORIGIN = { source: "paypal_sync" as const, actorId: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reconcilePayoutBatch with a manually paid item", () => {
  test("PayPal reporting DENIED does not flip a manually_paid item or release its earnings", async () => {
    const tables = buildTables([
      { id: "i1", status: "manually_paid", earning: "paid" },
      { id: "i2", status: "assumed_complete", earning: "payout_pending" },
    ]);
    paypalReports("DENIED", { i1: "DENIED", i2: "DENIED" });

    const result = await reconcilePayoutBatch(
      fakeClient(tables),
      { id: BATCH, paypalPayoutBatchId: "PP-1" },
      ORIGIN
    );

    expect(find(tables, "instructor_payout_items", "i1").status).toBe("manually_paid");
    expect(find(tables, "instructor_earnings", "earning-i1").status).toBe("paid");
    expect(find(tables, "instructor_payout_attempts", "attempt-i1").outcome).toBe("manually_paid");

    // The other instructor is still handled normally.
    expect(find(tables, "instructor_payout_items", "i2").status).toBe("denied");
    expect(find(tables, "instructor_earnings", "earning-i2").status).toBe("pending");
    expect(result.releasedCount).toBe(1);
  });

  test("a batch where every item was paid by hand stays manually_paid even if PayPal says DENIED", async () => {
    const tables = buildTables([{ id: "i1", status: "manually_paid", earning: "paid" }]);
    paypalReports("DENIED", { i1: "DENIED" });

    const result = await reconcilePayoutBatch(
      fakeClient(tables),
      { id: BATCH, paypalPayoutBatchId: "PP-1" },
      ORIGIN
    );

    expect(result.localBatchStatus).toBe("manually_paid");
    expect(result.releasedCount).toBe(0);
    expect(find(tables, "instructor_payout_batches", BATCH).status).toBe("manually_paid");
  });

  test("a DENIED batch that PayPal reports no items for does not release a manual item", async () => {
    const tables = buildTables([{ id: "i1", status: "manually_paid", earning: "paid" }]);
    paypalReports("DENIED", {});

    await reconcilePayoutBatch(
      fakeClient(tables),
      { id: BATCH, paypalPayoutBatchId: "PP-1" },
      ORIGIN
    );

    expect(find(tables, "instructor_payout_items", "i1").status).toBe("manually_paid");
    expect(find(tables, "instructor_earnings", "earning-i1").status).toBe("paid");
  });

  test("an ordinary denied batch with no manual items still denies and releases (no regression)", async () => {
    const tables = buildTables([{ id: "i1", status: "assumed_complete", earning: "payout_pending" }]);
    paypalReports("DENIED", { i1: "DENIED" });

    const result = await reconcilePayoutBatch(
      fakeClient(tables),
      { id: BATCH, paypalPayoutBatchId: "PP-1" },
      ORIGIN
    );

    expect(result.localBatchStatus).toBe("denied");
    expect(find(tables, "instructor_earnings", "earning-i1").status).toBe("pending");
    expect(find(tables, "instructor_payout_items", "i1").status).toBe("denied");
  });

  test("a mix of PayPal-confirmed and manually paid items finishes as completed", async () => {
    const tables = buildTables([
      { id: "i1", status: "manually_paid", earning: "paid" },
      { id: "i2", status: "assumed_complete", earning: "payout_pending" },
    ]);
    paypalReports("SUCCESS", { i1: "SUCCESS", i2: "SUCCESS" });

    const result = await reconcilePayoutBatch(
      fakeClient(tables),
      { id: BATCH, paypalPayoutBatchId: "PP-1" },
      ORIGIN
    );

    expect(find(tables, "instructor_payout_items", "i1").status).toBe("manually_paid");
    expect(find(tables, "instructor_payout_items", "i2").status).toBe("completed");
    expect(result.localBatchStatus).toBe("completed");
  });
});

describe("denyPayoutBatchLocally with a manually paid item", () => {
  test("marks only the unpaid items denied", async () => {
    const tables = buildTables([
      { id: "i1", status: "manually_paid", earning: "paid" },
      { id: "i2", status: "assumed_complete", earning: "payout_pending" },
    ]);

    const denied = await denyPayoutBatchLocally(fakeClient(tables), BATCH, {
      source: "manual",
      actorId: "admin-1",
      reason: "PayPal returned it",
    });

    expect(denied).toBe(1);
    expect(find(tables, "instructor_payout_items", "i1").status).toBe("manually_paid");
    expect(find(tables, "instructor_earnings", "earning-i1").status).toBe("paid");
    expect(find(tables, "instructor_payout_items", "i2").status).toBe("denied");
    expect(find(tables, "instructor_earnings", "earning-i2").status).toBe("pending");
  });
});
