/**
 * Unit tests for lib/cron-heartbeat.ts.
 *
 * Two properties matter most and are easy to get wrong:
 *   1. A manual admin trigger must NOT write a heartbeat. Counting one would
 *      mask a dead schedule — someone clicks the button, the job looks healthy,
 *      and nobody notices the cron itself stopped firing.
 *   2. A logging failure must never change the response the caller receives.
 *      The heartbeat is observability; it must not be able to break the job it
 *      is observing.
 *
 * External dependency mocked:
 *   @/lib/supabase/server — prevents the Next.js cookies() runtime requirement.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/server";
import {
  withCronHeartbeat,
  isCronRequest,
  summarizeCronHealth,
  type CronJobHealth,
} from "@/lib/cron-heartbeat";

const CRON_SECRET = "test-cron-secret";

/** Builds a request carrying a valid cron bearer token. */
function cronRequest(): Request {
  return new Request("https://example.com/api/whatever", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
}

/** Builds a request with no cron credentials (i.e. a manual admin trigger). */
function manualRequest(): Request {
  return new Request("https://example.com/api/whatever", { method: "POST" });
}

/**
 * Stubs createAdminClient so inserts into cron_run_log are captured.
 * @param insertError - Optional error for the insert to return.
 */
function stubAdmin(insertError: unknown = null) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const from = vi.fn().mockReturnValue({ insert });
  vi.mocked(createAdminClient).mockResolvedValue({
    from,
  } as unknown as Awaited<ReturnType<typeof createAdminClient>>);
  return { from, insert };
}

describe("isCronRequest", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
  });

  test("accepts a matching bearer token", () => {
    expect(isCronRequest(cronRequest())).toBe(true);
  });

  test("rejects a request with no Authorization header", () => {
    expect(isCronRequest(manualRequest())).toBe(false);
  });

  test("rejects everything when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(isCronRequest(cronRequest())).toBe(false);
  });
});

describe("withCronHeartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("does not log when the caller is a manual admin trigger", async () => {
    const { from } = stubAdmin();
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }));

    const res = await withCronHeartbeat("some-job", handler)(manualRequest());

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  test("logs a successful run for a cron-invoked call", async () => {
    const { from, insert } = stubAdmin();
    const handler = vi.fn().mockResolvedValue(Response.json({ alerted: 3 }));

    await withCronHeartbeat("alert-stuck-payout-batches", handler)(cronRequest());

    expect(from).toHaveBeenCalledWith("cron_run_log");
    const row = insert.mock.calls[0][0];
    expect(row.job_name).toBe("alert-stuck-payout-batches");
    expect(row.ok).toBe(true);
    expect(row.error_message).toBeNull();
    expect(typeof row.duration_ms).toBe("number");
  });

  test("records a count from the response body so no-op runs are visible", async () => {
    const { insert } = stubAdmin();
    const handler = vi.fn().mockResolvedValue(Response.json({ alerted: 0 }));

    await withCronHeartbeat("alert-stuck-payout-batches", handler)(cronRequest());

    expect(insert.mock.calls[0][0].records_touched).toBe(0);
  });

  test("leaves records_touched null when the body has no recognisable count", async () => {
    const { insert } = stubAdmin();
    const handler = vi.fn().mockResolvedValue(Response.json({ message: "done" }));

    await withCronHeartbeat("some-job", handler)(cronRequest());

    expect(insert.mock.calls[0][0].records_touched).toBeNull();
  });

  test("treats a non-2xx response as a failed run", async () => {
    const { insert } = stubAdmin();
    const handler = vi
      .fn()
      .mockResolvedValue(Response.json({ error: "nope" }, { status: 500 }));

    await withCronHeartbeat("some-job", handler)(cronRequest());

    const row = insert.mock.calls[0][0];
    expect(row.ok).toBe(false);
    expect(row.error_message).toBe("HTTP 500");
  });

  test("logs a failure and rethrows when the handler throws", async () => {
    const { insert } = stubAdmin();
    const handler = vi.fn().mockRejectedValue(new Error("kaboom"));

    await expect(
      withCronHeartbeat("some-job", handler)(cronRequest())
    ).rejects.toThrow("kaboom");

    const row = insert.mock.calls[0][0];
    expect(row.ok).toBe(false);
    expect(row.error_message).toBe("kaboom");
  });

  test("returns the handler's response body unconsumed", async () => {
    stubAdmin();
    const handler = vi.fn().mockResolvedValue(Response.json({ upserted: 12 }));

    const res = await withCronHeartbeat("some-job", handler)(cronRequest());

    // The wrapper reads a clone to extract the count; the original must survive.
    await expect(res.json()).resolves.toEqual({ upserted: 12 });
  });

  test("still returns the response when writing the heartbeat fails", async () => {
    stubAdmin({ message: "insert denied" });
    const handler = vi.fn().mockResolvedValue(Response.json({ sent: 1 }));

    const res = await withCronHeartbeat("some-job", handler)(cronRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: 1 });
  });

  test("still returns the response when the admin client itself throws", async () => {
    vi.mocked(createAdminClient).mockRejectedValue(new Error("no db"));
    const handler = vi.fn().mockResolvedValue(Response.json({ sent: 1 }));

    const res = await withCronHeartbeat("some-job", handler)(cronRequest());

    expect(res.status).toBe(200);
  });

  test("truncates a very long error message", async () => {
    const { insert } = stubAdmin();
    const handler = vi.fn().mockRejectedValue(new Error("x".repeat(5000)));

    await expect(
      withCronHeartbeat("some-job", handler)(cronRequest())
    ).rejects.toThrow();

    expect(insert.mock.calls[0][0].error_message).toHaveLength(1000);
  });
});

describe("summarizeCronHealth", () => {
  /**
   * Builds a CronJobHealth with sensible defaults.
   * @param over - Fields to override.
   */
  function job(over: Partial<CronJobHealth> = {}): CronJobHealth {
    return {
      jobName: "a-job",
      schedule: "0 0 * * *",
      lastSuccess: new Date().toISOString(),
      minutesSince: 5,
      maxGapMinutes: 1500,
      isOverdue: false,
      ...over,
    };
  }

  test("treats an empty result as unhealthy, not as all-clear", () => {
    const s = summarizeCronHealth([]);
    expect(s.jobsTracked).toBe(0);
    expect(s.healthy).toBe(false);
  });

  test("reports healthy only when jobs were tracked and none are overdue", () => {
    const s = summarizeCronHealth([job(), job({ jobName: "b-job" })]);
    expect(s.jobsTracked).toBe(2);
    expect(s.healthy).toBe(true);
    expect(s.overdue).toEqual([]);
  });

  test("collects overdue jobs and marks the summary unhealthy", () => {
    const s = summarizeCronHealth([
      job({ jobName: "fine" }),
      job({ jobName: "late", isOverdue: true, minutesSince: 3000 }),
    ]);
    expect(s.healthy).toBe(false);
    expect(s.overdue.map((j) => j.jobName)).toEqual(["late"]);
  });

  test("sorts a never-reported job ahead of a merely late one", () => {
    const s = summarizeCronHealth([
      job({ jobName: "late", isOverdue: true, minutesSince: 9000 }),
      job({
        jobName: "never",
        isOverdue: true,
        minutesSince: null,
        lastSuccess: null,
      }),
    ]);
    expect(s.overdue.map((j) => j.jobName)).toEqual(["never", "late"]);
  });
});
