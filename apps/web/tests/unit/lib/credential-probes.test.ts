/**
 * Unit tests for lib/credential-probes.ts.
 *
 * The properties locked in here are the ones whose failure would make the probe
 * job worse than useless — a monitor that reports "healthy" while a credential is
 * dead actively manufactures false confidence:
 *
 *   1. Zero probes must NOT read as healthy. An empty result means the job broke.
 *   2. `unconfigured` must not be actionable — staging legitimately lacks keys,
 *      and a banner that cries wolf daily stops being read.
 *   3. `probe_failed` MUST be actionable. Unreachable is unknown, never a pass.
 *   4. Ranking must put dead credentials above expiry warnings.
 *
 * Network probes are covered by asserting on the *semantic* body rather than the
 * HTTP status, which is the whole point of the module: Google returned HTTP 200
 * with REQUEST_DENIED in the body, and that is how the outage stayed invisible.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  summarizeProbes,
  senderDomain,
  probeGooglePlaces,
  probeTurnstileSecret,
  EXPIRY_WARNING_DAYS,
  type CredentialProbe,
  type ProbeStatus,
} from "@/lib/credential-probes";

/** Builds a probe result with sensible defaults. */
function probe(over: Partial<CredentialProbe> & { status: ProbeStatus }): CredentialProbe {
  return {
    name: over.name ?? "test_probe",
    label: over.label ?? "Test probe",
    detail: over.detail ?? "detail",
    expiresAt: over.expiresAt ?? null,
    daysUntilExpiry: over.daysUntilExpiry ?? null,
    status: over.status,
  };
}

describe("summarizeProbes", () => {
  test("treats zero probes as unhealthy, not as an all-clear", () => {
    const s = summarizeProbes([]);
    expect(s.probesRun).toBe(0);
    expect(s.healthy).toBe(false);
  });

  test("is healthy only when every probe passed", () => {
    const s = summarizeProbes([probe({ status: "healthy" }), probe({ status: "healthy" })]);
    expect(s.healthy).toBe(true);
    expect(s.actionable).toHaveLength(0);
  });

  test("does not treat unconfigured credentials as a problem", () => {
    const s = summarizeProbes([
      probe({ status: "healthy" }),
      probe({ name: "absent", status: "unconfigured" }),
    ]);
    expect(s.healthy).toBe(true);
    expect(s.actionable).toHaveLength(0);
  });

  test("treats an unreachable provider as actionable, never as a pass", () => {
    const s = summarizeProbes([probe({ name: "flaky", status: "probe_failed" })]);
    expect(s.healthy).toBe(false);
    expect(s.failed).toHaveLength(1);
    expect(s.actionable.map((p) => p.name)).toContain("flaky");
  });

  test("counts dead and degraded separately", () => {
    const s = summarizeProbes([
      probe({ name: "d", status: "dead" }),
      probe({ name: "g", status: "degraded" }),
      probe({ name: "h", status: "healthy" }),
    ]);
    expect(s.dead).toHaveLength(1);
    expect(s.degraded).toHaveLength(1);
    expect(s.healthy).toBe(false);
  });

  test("flags a healthy credential expiring inside the warning window", () => {
    const s = summarizeProbes([
      probe({ name: "soon", status: "healthy", daysUntilExpiry: EXPIRY_WARNING_DAYS - 1 }),
    ]);
    expect(s.expiringSoon).toHaveLength(1);
    expect(s.healthy).toBe(false);
  });

  test("ignores an expiry comfortably beyond the warning window", () => {
    const s = summarizeProbes([
      probe({ name: "later", status: "healthy", daysUntilExpiry: EXPIRY_WARNING_DAYS + 30 }),
    ]);
    expect(s.expiringSoon).toHaveLength(0);
    expect(s.healthy).toBe(true);
  });

  test("a never-expiring credential is not treated as expiring", () => {
    // Regression guard: null must not compare as 0 and land in expiringSoon.
    const s = summarizeProbes([probe({ status: "healthy", daysUntilExpiry: null })]);
    expect(s.expiringSoon).toHaveLength(0);
    expect(s.healthy).toBe(true);
  });

  test("ranks dead above unknown above degraded above expiring", () => {
    const s = summarizeProbes([
      probe({ name: "expiring", status: "healthy", daysUntilExpiry: 3 }),
      probe({ name: "degraded", status: "degraded" }),
      probe({ name: "dead", status: "dead" }),
      probe({ name: "unknown", status: "probe_failed" }),
    ]);
    expect(s.actionable.map((p) => p.name)).toEqual([
      "dead",
      "unknown",
      "degraded",
      "expiring",
    ]);
  });

  test("sorts soonest expiry first within the same status", () => {
    const s = summarizeProbes([
      probe({ name: "ten", status: "healthy", daysUntilExpiry: 10 }),
      probe({ name: "two", status: "healthy", daysUntilExpiry: 2 }),
    ]);
    expect(s.actionable.map((p) => p.name)).toEqual(["two", "ten"]);
  });
});

describe("senderDomain", () => {
  test("parses the angle-bracket form used by RESEND_FROM_EMAIL", () => {
    expect(senderDomain("SuperHeroCPR <noreply@update.superherocpr.com>")).toBe(
      "update.superherocpr.com"
    );
  });

  test("parses a bare address", () => {
    expect(senderDomain("noreply@example.com")).toBe("example.com");
  });

  test("returns null when there is no address", () => {
    expect(senderDomain("not an email")).toBeNull();
  });
});

describe("probeGooglePlaces", () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  test("reports dead on REQUEST_DENIED even though the HTTP status is 200", async () => {
    // This is the exact shape of the real 2026-08-20 outage: HTTP 200, refused in
    // the body. A probe asserting on res.ok would call this healthy.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "REQUEST_DENIED",
          error_message: "You must enable Billing on the Google Cloud Project",
        }),
        { status: 200 }
      )
    );

    const result = await probeGooglePlaces();
    expect(result.status).toBe("dead");
    expect(result.detail).toContain("REQUEST_DENIED");
    expect(result.detail).toContain("Billing");
  });

  test("reports healthy on OK", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "OK", predictions: [] }), { status: 200 })
    );
    expect((await probeGooglePlaces()).status).toBe("healthy");
  });

  test("treats ZERO_RESULTS as healthy — the key was still accepted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ZERO_RESULTS" }), { status: 200 })
    );
    expect((await probeGooglePlaces()).status).toBe("healthy");
  });

  test("reports dead when the quota is exhausted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "OVER_QUERY_LIMIT" }), { status: 200 })
    );
    expect((await probeGooglePlaces()).status).toBe("dead");
  });

  test("reports probe_failed rather than healthy when the network throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    const result = await probeGooglePlaces();
    expect(result.status).toBe("probe_failed");
    expect(result.detail).toContain("ECONNRESET");
  });

  test("reports unconfigured when the key is absent", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect((await probeGooglePlaces()).status).toBe("unconfigured");
  });
});

describe("probeTurnstileSecret", () => {
  const original = process.env.TURNSTILE_SECRET_KEY;

  afterEach(() => {
    process.env.TURNSTILE_SECRET_KEY = original;
    vi.restoreAllMocks();
  });

  test("reports dead when the secret is missing — this is the THREAT-062 state", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const result = await probeTurnstileSecret();
    // Deliberately NOT "unconfigured": a missing secret makes verification fail
    // open, which is a live vulnerability rather than an absent feature.
    expect(result.status).toBe("dead");
    expect(result.detail).toContain("THREAT-062");
  });

  test("treats invalid-input-response as healthy — the secret was accepted", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }),
        { status: 200 }
      )
    );
    expect((await probeTurnstileSecret()).status).toBe("healthy");
  });

  test("reports dead when Cloudflare rejects the secret itself", async () => {
    process.env.TURNSTILE_SECRET_KEY = "wrong";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ success: false, "error-codes": ["invalid-input-secret"] }),
        { status: 200 }
      )
    );
    expect((await probeTurnstileSecret()).status).toBe("dead");
  });
});
