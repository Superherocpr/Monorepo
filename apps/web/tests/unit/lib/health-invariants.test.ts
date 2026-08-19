/**
 * Unit tests for lib/health-invariants.ts.
 *
 * The property that matters most here is that an absent result is reported as
 * UNHEALTHY rather than clean. The whole point of the canary is to distinguish
 * "nothing is wrong" from "nothing ran", and getting that backwards would
 * reintroduce exactly the false-green problem it was built to fix.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  summarizeInvariants,
  fetchHealthInvariants,
  type HealthInvariant,
} from "@/lib/health-invariants";

/**
 * Builds a HealthInvariant with sensible defaults.
 * @param over - Fields to override.
 */
function inv(over: Partial<HealthInvariant> = {}): HealthInvariant {
  return {
    checkName: "some_check",
    severity: "critical",
    breachCount: 0,
    detail: "detail text",
    ...over,
  };
}

/**
 * Builds a stub Supabase client whose rpc() resolves to the given payload.
 * @param data - Rows to return.
 * @param error - Optional error to return instead.
 */
function stubClient(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("summarizeInvariants", () => {
  it("treats an empty result as unhealthy, not as all-clear", () => {
    const s = summarizeInvariants([]);

    expect(s.checksRun).toBe(0);
    expect(s.healthy).toBe(false);
    expect(s.breachedCount).toBe(0);
  });

  it("reports healthy only when checks ran and none were breached", () => {
    const s = summarizeInvariants([inv(), inv({ checkName: "other" })]);

    expect(s.checksRun).toBe(2);
    expect(s.healthy).toBe(true);
    expect(s.breached).toEqual([]);
  });

  it("counts critical and warning breaches separately", () => {
    const s = summarizeInvariants([
      inv({ checkName: "a", severity: "critical", breachCount: 2 }),
      inv({ checkName: "b", severity: "warning", breachCount: 5 }),
      inv({ checkName: "c", severity: "critical", breachCount: 0 }),
    ]);

    expect(s.criticalBreaches).toBe(2);
    expect(s.warningBreaches).toBe(5);
    expect(s.breachedCount).toBe(2);
    expect(s.healthy).toBe(false);
  });

  it("ranks criticals above warnings even when the warning count is larger", () => {
    const s = summarizeInvariants([
      inv({ checkName: "noisy_warning", severity: "warning", breachCount: 99 }),
      inv({ checkName: "one_critical", severity: "critical", breachCount: 1 }),
    ]);

    expect(s.breached.map((b) => b.checkName)).toEqual([
      "one_critical",
      "noisy_warning",
    ]);
  });

  it("orders by descending breach count within the same severity", () => {
    const s = summarizeInvariants([
      inv({ checkName: "small", severity: "critical", breachCount: 1 }),
      inv({ checkName: "big", severity: "critical", breachCount: 7 }),
    ]);

    expect(s.breached.map((b) => b.checkName)).toEqual(["big", "small"]);
  });

  it("excludes passing checks from the breached list", () => {
    const s = summarizeInvariants([
      inv({ checkName: "passing", breachCount: 0 }),
      inv({ checkName: "failing", breachCount: 3 }),
    ]);

    expect(s.breached).toHaveLength(1);
    expect(s.breached[0].checkName).toBe("failing");
  });
});

describe("fetchHealthInvariants", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the health_invariants RPC", async () => {
    const { client, rpc } = stubClient([]);

    await fetchHealthInvariants(client);

    expect(rpc).toHaveBeenCalledWith("health_invariants");
  });

  it("coerces bigint breach counts arriving as strings", async () => {
    const { client } = stubClient([
      {
        check_name: "booking_missing_payment",
        severity: "critical",
        breach_count: "4",
        detail: "d",
      },
    ]);

    const rows = await fetchHealthInvariants(client);

    expect(rows[0].breachCount).toBe(4);
    expect(typeof rows[0].breachCount).toBe("number");
  });

  it("returns an empty array on RPC error rather than throwing", async () => {
    const { client } = stubClient(null, { message: "permission denied" });

    await expect(fetchHealthInvariants(client)).resolves.toEqual([]);
  });

  it("surfaces an RPC failure as unhealthy once summarised", async () => {
    const { client } = stubClient(null, { message: "boom" });

    const summary = summarizeInvariants(await fetchHealthInvariants(client));

    expect(summary.healthy).toBe(false);
    expect(summary.checksRun).toBe(0);
  });

  it("defaults an unrecognised severity to warning instead of dropping the row", async () => {
    const { client } = stubClient([
      { check_name: "odd", severity: "bananas", breach_count: 1, detail: "d" },
    ]);

    const rows = await fetchHealthInvariants(client);

    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("warning");
  });
});
