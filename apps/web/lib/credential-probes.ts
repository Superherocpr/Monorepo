/**
 * Third-party credential liveness probes.
 *
 * WHY THIS EXISTS
 *   Every external credential this app holds fails *silently*. A dead Facebook
 *   token makes refresh-social-feed-cache return 200 and cache nothing. A dead
 *   Google Places key makes the address autocomplete return a friendly "please
 *   enter it manually" and log to a console nobody reads. Nothing is down, so
 *   nothing alerts, and the feature is simply gone.
 *
 *   That is not hypothetical: a manual audit on 2026-08-20 found GOOGLE_PLACES_API_KEY
 *   had been refused by Google (billing disabled on the GCP project) for an unknown
 *   length of time. Three curl commands found it. This module is those three curl
 *   commands, on a schedule.
 *
 * THE CENTRAL RULE — ASSERT ON THE SEMANTIC RESULT, NEVER ON HTTP STATUS
 *   Google returned **HTTP 200** with `"status": "REQUEST_DENIED"` in the body.
 *   Any uptime check that asserts on status codes would have called that healthy
 *   for months. Every probe below parses the provider's own verdict out of the
 *   response body. A probe that only checks `res.ok` is worse than no probe,
 *   because it manufactures confidence.
 *
 * Consumed by /api/cron/probe-credentials.
 */

/** Outcome of a single credential probe. */
export type ProbeStatus =
  /** The credential works right now. */
  | "healthy"
  /** The credential is rejected by the provider. The feature is broken. */
  | "dead"
  /** Reachable but not fully right — e.g. a domain that is pending verification. */
  | "degraded"
  /** Not configured in this environment. Not a failure; nothing to check. */
  | "unconfigured"
  /** The probe itself could not complete (network, timeout). State unknown. */
  | "probe_failed";

/** Result of probing one credential. */
export interface CredentialProbe {
  /** Stable machine name, e.g. "google_places". */
  name: string;
  /** Human-readable label for the digest. */
  label: string;
  status: ProbeStatus;
  /** What the provider actually said. Safe to show an admin; never contains the secret. */
  detail: string;
  /** ISO timestamp of credential expiry when the provider reports one, else null. */
  expiresAt: string | null;
  /** Whole days until expiry; negative if already past. null when it never expires. */
  daysUntilExpiry: number | null;
}

/** Aggregate view of one probe run, shaped for the digest. */
export interface ProbeSummary {
  /** Probes that ran. Zero means the probe job itself failed — NOT an all-clear. */
  probesRun: number;
  /** Credentials the provider actively rejected. */
  dead: CredentialProbe[];
  /** Reachable but misconfigured. */
  degraded: CredentialProbe[];
  /** Healthy today but expiring inside EXPIRY_WARNING_DAYS. */
  expiringSoon: CredentialProbe[];
  /** Probes that could not complete — unknown state, deliberately not "healthy". */
  failed: CredentialProbe[];
  /** True only when at least one probe ran and nothing needs attention. */
  healthy: boolean;
  /** Everything needing attention, most urgent first. Ready to render. */
  actionable: CredentialProbe[];
}

/** Warn this many days ahead of a credential expiring. */
export const EXPIRY_WARNING_DAYS = 14;

/** Per-probe network budget. Keeps one hung provider from stalling the whole job. */
const PROBE_TIMEOUT_MS = 10_000;

/** Ranking for `actionable` — lower sorts first. */
const STATUS_RANK: Record<ProbeStatus, number> = {
  dead: 0,
  probe_failed: 1,
  degraded: 2,
  healthy: 3,
  unconfigured: 4,
};

// ── Pure reporting logic (no I/O — unit-testable without network) ─────────────

/**
 * Reduces raw probe results to the numbers the digest reports.
 * Pure — no I/O — so the reporting logic is testable without touching a provider.
 *
 * `unconfigured` is deliberately not actionable: staging legitimately lacks some
 * credentials, and treating absence as failure would make the banner cry wolf
 * every single day until someone stopped reading it.
 *
 * @param probes - Every probe result, healthy ones included.
 * @returns Aggregate counts plus the probes needing attention, ranked.
 */
export function summarizeProbes(probes: CredentialProbe[]): ProbeSummary {
  const dead = probes.filter((p) => p.status === "dead");
  const degraded = probes.filter((p) => p.status === "degraded");
  const failed = probes.filter((p) => p.status === "probe_failed");

  const expiringSoon = probes.filter(
    (p) =>
      p.status === "healthy" &&
      p.daysUntilExpiry !== null &&
      p.daysUntilExpiry <= EXPIRY_WARNING_DAYS
  );

  const actionable = [...dead, ...failed, ...degraded, ...expiringSoon].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    // Within a status, soonest-expiring first; non-expiring last.
    return (a.daysUntilExpiry ?? Infinity) - (b.daysUntilExpiry ?? Infinity);
  });

  return {
    probesRun: probes.length,
    dead,
    degraded,
    expiringSoon,
    failed,
    // An empty result set means the job broke, not that everything passed.
    healthy: probes.length > 0 && actionable.length === 0,
    actionable,
  };
}

// ── Probe helpers ────────────────────────────────────────────────────────────

/**
 * fetch() with a hard timeout, so one unresponsive provider cannot hang the job.
 * @param url - Target URL.
 * @param init - Standard fetch options.
 * @returns The response.
 * @throws If the request fails or exceeds PROBE_TIMEOUT_MS.
 */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds the result for a credential that is not set in this environment.
 * @param name - Machine name.
 * @param label - Human label.
 * @param envVar - The variable that is missing.
 * @returns An `unconfigured` probe result.
 */
function unconfigured(name: string, label: string, envVar: string): CredentialProbe {
  return {
    name,
    label,
    status: "unconfigured",
    detail: `${envVar} is not set in this environment — nothing to check.`,
    expiresAt: null,
    daysUntilExpiry: null,
  };
}

/**
 * Wraps a probe so a thrown error becomes `probe_failed` rather than taking the
 * whole job down. An unreachable provider is an unknown state, never a pass.
 * @param name - Machine name.
 * @param label - Human label.
 * @param run - The probe body.
 * @returns The probe's result, or a probe_failed result if it threw.
 */
async function guarded(
  name: string,
  label: string,
  run: () => Promise<CredentialProbe>
): Promise<CredentialProbe> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name,
      label,
      status: "probe_failed",
      detail: `Probe could not complete: ${message}`,
      expiresAt: null,
      daysUntilExpiry: null,
    };
  }
}

/**
 * Converts a Unix expiry into calendar days from now.
 * @param unixSeconds - Expiry as a Unix timestamp; 0 means "never expires".
 * @returns ISO expiry and whole days remaining, both null when it never expires.
 */
function expiryFromUnix(unixSeconds: number): {
  expiresAt: string | null;
  daysUntilExpiry: number | null;
} {
  if (!unixSeconds) return { expiresAt: null, daysUntilExpiry: null };
  const when = new Date(unixSeconds * 1000);
  const days = Math.floor((when.getTime() - Date.now()) / 86_400_000);
  return { expiresAt: when.toISOString(), daysUntilExpiry: days };
}

/**
 * Extracts the domain from a From header that may be either a bare address or
 * the "Display Name <addr@domain>" form.
 * @param from - RESEND_FROM_EMAIL value.
 * @returns The domain, or null if it cannot be parsed.
 */
export function senderDomain(from: string): string | null {
  const angled = /<([^>]+)>/.exec(from);
  const address = (angled ? angled[1] : from).trim();
  const at = address.lastIndexOf("@");
  return at === -1 ? null : address.slice(at + 1).toLowerCase() || null;
}

// ── Individual probes ────────────────────────────────────────────────────────

/**
 * Probes FACEBOOK_PAGE_ACCESS_TOKEN via Graph API debug_token.
 * Side effects: one outbound HTTPS request to graph.facebook.com.
 *
 * Note: page tokens minted from a long-lived user token report `expires_at: 0`
 * (never). They can still be killed by a password change, a permission
 * revocation, or a Page role change — which is exactly why liveness is checked
 * here rather than assuming a 60-day clock.
 *
 * @returns Probe result. Never throws.
 */
export async function probeFacebookToken(): Promise<CredentialProbe> {
  const name = "facebook_page_token";
  const label = "Facebook page access token";
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) return unconfigured(name, label, "FACEBOOK_PAGE_ACCESS_TOKEN");

  return guarded(name, label, async () => {
    const url =
      "https://graph.facebook.com/debug_token" +
      `?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
    const res = await fetchWithTimeout(url);
    const body = (await res.json()) as {
      data?: { is_valid?: boolean; expires_at?: number; error?: { message?: string } };
      error?: { message?: string };
    };

    if (body.error) {
      return {
        name,
        label,
        status: "dead",
        detail: `Graph API rejected the token: ${body.error.message ?? "unknown error"}`,
        expiresAt: null,
        daysUntilExpiry: null,
      };
    }

    const data = body.data ?? {};
    if (!data.is_valid) {
      return {
        name,
        label,
        status: "dead",
        detail: `Token is not valid: ${data.error?.message ?? "no reason given"}. The social feed will cache nothing.`,
        expiresAt: null,
        daysUntilExpiry: null,
      };
    }

    const { expiresAt, daysUntilExpiry } = expiryFromUnix(data.expires_at ?? 0);
    return {
      name,
      label,
      status: "healthy",
      detail: expiresAt
        ? `Valid, expires ${expiresAt.slice(0, 10)}.`
        : "Valid; does not expire.",
      expiresAt,
      daysUntilExpiry,
    };
  });
}

/**
 * Probes GOOGLE_PLACES_API_KEY against the same autocomplete endpoint the app
 * uses, so the probe fails exactly when the feature would.
 * Side effects: one outbound HTTPS request to maps.googleapis.com (one Places call).
 *
 * Google answers HTTP 200 even when refusing the key, so the verdict is read
 * from `status` in the body. This is the failure that motivated the module.
 *
 * @returns Probe result. Never throws.
 */
export async function probeGooglePlaces(): Promise<CredentialProbe> {
  const name = "google_places";
  const label = "Google Places API key";
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return unconfigured(name, label, "GOOGLE_PLACES_API_KEY");

  return guarded(name, label, async () => {
    const params = new URLSearchParams({
      input: "1600 Amphitheatre",
      types: "address",
      components: "country:us",
      key,
    });
    const res = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`
    );
    const body = (await res.json()) as { status?: string; error_message?: string };
    const status = body.status ?? "UNKNOWN";

    // ZERO_RESULTS still proves the key is accepted and billed.
    if (status === "OK" || status === "ZERO_RESULTS") {
      return {
        name,
        label,
        status: "healthy",
        detail: `Autocomplete returned ${status}.`,
        expiresAt: null,
        daysUntilExpiry: null,
      };
    }

    const dead = status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT";
    return {
      name,
      label,
      status: dead ? "dead" : "degraded",
      detail:
        `Autocomplete returned ${status}` +
        (body.error_message ? `: ${body.error_message}` : "") +
        ". Address lookup is falling back to manual entry on the profile and admin location forms.",
      expiresAt: null,
      daysUntilExpiry: null,
    };
  });
}

/**
 * Probes RESEND_API_KEY and confirms the sending domain is verified.
 * Side effects: one outbound HTTPS request to api.resend.com.
 *
 * A 401 means the key is dead and roughly twenty transactional send sites are
 * silently failing. A domain that is not `verified` means mail will be rejected
 * or spam-foldered even though the key works.
 *
 * @returns Probe result. Never throws.
 */
export async function probeResend(): Promise<CredentialProbe> {
  const name = "resend";
  const label = "Resend API key + sending domain";
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key) return unconfigured(name, label, "RESEND_API_KEY");

  return guarded(name, label, async () => {
    const res = await fetchWithTimeout("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (res.status === 401 || res.status === 403) {
      return {
        name,
        label,
        status: "dead",
        detail: `Resend rejected the API key (HTTP ${res.status}). All transactional email is failing.`,
        expiresAt: null,
        daysUntilExpiry: null,
      };
    }

    const body = (await res.json()) as {
      data?: Array<{ name?: string; status?: string }>;
    };
    const domains = body.data ?? [];
    const wanted = from ? senderDomain(from) : null;

    if (!wanted) {
      return {
        name,
        label,
        status: "healthy",
        detail: `API key accepted; ${domains.length} domain(s) registered. RESEND_FROM_EMAIL not parseable, so domain state was not checked.`,
        expiresAt: null,
        daysUntilExpiry: null,
      };
    }

    const match = domains.find((d) => (d.name ?? "").toLowerCase() === wanted);
    if (!match) {
      return {
        name,
        label,
        status: "degraded",
        detail: `API key accepted, but sending domain ${wanted} is not registered with this Resend account.`,
        expiresAt: null,
        daysUntilExpiry: null,
      };
    }

    if (match.status !== "verified") {
      return {
        name,
        label,
        status: "degraded",
        detail: `Sending domain ${wanted} is "${match.status ?? "unknown"}", not verified. Deliverability is at risk.`,
        expiresAt: null,
        daysUntilExpiry: null,
      };
    }

    return {
      name,
      label,
      status: "healthy",
      detail: `API key accepted; ${wanted} is verified.`,
      expiresAt: null,
      daysUntilExpiry: null,
    };
  });
}

/**
 * Probes TURNSTILE_SECRET_KEY by deliberately submitting an invalid token.
 * Side effects: one outbound HTTPS request to challenges.cloudflare.com.
 *
 * The trick: Cloudflare distinguishes a bad *secret* from a bad *token*. Sending
 * a junk token and getting back `invalid-input-response` proves the secret was
 * accepted — which is the thing we want to know — without needing a real token.
 * `invalid-input-secret` means the secret itself is wrong.
 *
 * @returns Probe result. Never throws.
 */
export async function probeTurnstileSecret(): Promise<CredentialProbe> {
  const name = "turnstile_secret";
  const label = "Turnstile secret key";
  const secret = process.env.TURNSTILE_SECRET_KEY;
  // Absence is the THREAT-062 condition: verifyTurnstileToken() fails OPEN, so
  // the contact form accepts anything. Report it as dead, not unconfigured.
  if (!secret) {
    return {
      name,
      label,
      status: "dead",
      detail:
        "TURNSTILE_SECRET_KEY is not set. verifyTurnstileToken() fails open, so /api/contact accepts any token. See THREAT-062.",
      expiresAt: null,
      daysUntilExpiry: null,
    };
  }

  return guarded(name, label, async () => {
    const res = await fetchWithTimeout(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({ secret, response: "probe-invalid-token" }),
      }
    );
    const body = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    const codes = body["error-codes"] ?? [];

    if (codes.includes("invalid-input-secret") || codes.includes("missing-input-secret")) {
      return {
        name,
        label,
        status: "dead",
        detail: "Cloudflare rejected the secret key. Captcha verification is not working.",
        expiresAt: null,
        daysUntilExpiry: null,
      };
    }

    // Expected: the secret was accepted, only the junk token was rejected.
    return {
      name,
      label,
      status: "healthy",
      detail: "Secret accepted by Cloudflare siteverify.",
      expiresAt: null,
      daysUntilExpiry: null,
    };
  });
}

/**
 * Probes the stored Zoho OAuth refresh token by exchanging it for an access token.
 * Side effects: one outbound HTTPS request to accounts.zoho.com. Does NOT persist
 * the returned access token — this is a read-only liveness check, and writing here
 * would make the probe a side-effecting participant in the auth flow.
 *
 * The refresh token lives in system_settings (`zoho_refresh_token`), not in the
 * environment, so the caller supplies it.
 *
 * @param refreshToken - Value of system_settings.zoho_refresh_token, or null.
 * @returns Probe result. Never throws.
 */
export async function probeZohoRefreshToken(
  refreshToken: string | null
): Promise<CredentialProbe> {
  const name = "zoho_refresh_token";
  const label = "Zoho OAuth refresh token";
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return unconfigured(name, label, "ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET");
  }
  if (!refreshToken) {
    return {
      name,
      label,
      status: "dead",
      detail:
        "No zoho_refresh_token in system_settings — Zoho Mail is not connected. The contact inbox cannot sync.",
      expiresAt: null,
      daysUntilExpiry: null,
    };
  }

  return guarded(name, label, async () => {
    const res = await fetchWithTimeout("https://accounts.zoho.com/oauth/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    // Zoho answers 200 with an `error` field on a revoked token, so parse the body.
    const body = (await res.json()) as { access_token?: string; error?: string };

    if (body.error || !body.access_token) {
      return {
        name,
        label,
        status: "dead",
        detail: `Zoho refused the refresh token: ${body.error ?? "no access_token returned"}. The contact inbox will stop syncing.`,
        expiresAt: null,
        daysUntilExpiry: null,
      };
    }

    return {
      name,
      label,
      status: "healthy",
      detail: "Refresh token exchanged for an access token successfully.",
      expiresAt: null,
      daysUntilExpiry: null,
    };
  });
}

/**
 * Runs every credential probe concurrently.
 * Side effects: one outbound HTTPS request per configured credential.
 *
 * Uses allSettled semantics via `guarded`, so one provider being unreachable
 * cannot prevent the others from reporting.
 *
 * @param opts.zohoRefreshToken - system_settings.zoho_refresh_token, or null.
 * @returns One result per probe, in a stable order.
 */
export async function runCredentialProbes(opts: {
  zohoRefreshToken: string | null;
}): Promise<CredentialProbe[]> {
  return Promise.all([
    probeGooglePlaces(),
    probeFacebookToken(),
    probeResend(),
    probeTurnstileSecret(),
    probeZohoRefreshToken(opts.zohoRefreshToken),
  ]);
}
