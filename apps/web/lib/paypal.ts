/**
 * PayPal shared helpers — credentials, environment URLs, auth-assertion JWT,
 * and instructor OAuth-token refresh.
 *
 * Two distinct PayPal apps are used:
 *   1. The **business REST API app** — credentials `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
 *      + `PAYPAL_SECRET`. Used to create checkout orders and capture payments
 *      via `getPayPalAccessToken()`.
 *   2. The **Commerce Platform / Log-in-with-PayPal app** — credentials
 *      `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET`. Used for instructor OAuth
 *      onboarding and acting on the instructor's behalf via the
 *      `PayPal-Auth-Assertion` header.
 *
 * `PAYPAL_API_BASE` controls the environment (sandbox vs live) for ALL PayPal
 * calls in the codebase. Production deployments must set it explicitly so a
 * missing env var cannot silently send real customers through sandbox PayPal.
 * The browser-facing OAuth consent screen URL is derived from the same value via
 * `getPayPalConnectBase()` so sandbox/live can never drift between the API and
 * consent screen.
 *
 * Server-side only. Never import this in client components.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptToken, decryptToken } from "@/lib/crypto";

// ---------------------------------------------------------------------------
// Environment URLs
// ---------------------------------------------------------------------------

/** PayPal sandbox REST API base. */
const SANDBOX_API = "https://api-m.sandbox.paypal.com";
/** PayPal production REST API base. */
const LIVE_API = "https://api-m.paypal.com";
/** PayPal sandbox consent-screen base. */
const SANDBOX_CONNECT = "https://www.sandbox.paypal.com";
/** PayPal production consent-screen base. */
const LIVE_CONNECT = "https://www.paypal.com";

/**
 * Returns the PayPal REST API base URL for the current environment.
 * Defaults to sandbox in local development only. Production requires an
 * explicit PAYPAL_API_BASE so payments cannot accidentally run against sandbox.
 * @throws Error when PAYPAL_API_BASE is missing in production.
 */
export function getPayPalApiBase(): string {
  const configuredBase = process.env.PAYPAL_API_BASE;
  if (configuredBase) return configuredBase;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "PAYPAL_API_BASE must be set in production to either https://api-m.paypal.com or https://api-m.sandbox.paypal.com."
    );
  }
  return SANDBOX_API;
}

/**
 * Returns the PayPal consent-screen base URL (used for instructor OAuth init),
 * derived from `PAYPAL_API_BASE`. Sandbox-API ⇒ sandbox consent screen.
 * This keeps API + consent-screen environments synchronized — preventing the
 * common bug where the user is redirected to live PayPal but the callback
 * exchange tries to hit the sandbox API (or vice-versa).
 */
export function getPayPalConnectBase(): string {
  return getPayPalApiBase() === LIVE_API ? LIVE_CONNECT : SANDBOX_CONNECT;
}

// ---------------------------------------------------------------------------
// Business REST API — client-credentials access token
// ---------------------------------------------------------------------------

/**
 * Requests a PayPal access token for the **business** REST API app using
 * HTTP Basic auth + client-credentials grant.
 * Used to create checkout orders, capture payments, and issue refunds on the
 * business's own merchant account.
 * @returns Bearer token string for use in PayPal REST API calls.
 * @throws Error if NEXT_PUBLIC_PAYPAL_CLIENT_ID or PAYPAL_SECRET are missing,
 *         or the auth call fails.
 */
export async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";
  const clientSecret = process.env.PAYPAL_SECRET ?? "";

  // Buffer.from produces standard Base64 — required by PayPal's Basic auth spec
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const response = await fetch(`${getPayPalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    // Opt out of Next.js data cache — access tokens expire in 9h and must not be stale
    cache: "no-store",
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`PayPal auth failed (${response.status}): ${err}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

// ---------------------------------------------------------------------------
// PayPal-Auth-Assertion JWT (acting on an instructor's behalf)
// ---------------------------------------------------------------------------

/**
 * Base64url-encodes a string (RFC 4648 §5) — the encoding required for the
 * unsigned JWT used in the `PayPal-Auth-Assertion` header.
 * @param input - The raw string to encode.
 */
function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Builds an unsigned `PayPal-Auth-Assertion` JWT for routing a payment to a
 * specific merchant (the instructor).
 *
 * Per PayPal spec the payload MUST include `iss` (the partner client_id) AND
 * either `payer_id` (preferred — the merchant's PayPal payer ID) or `email`.
 * Without `iss` PayPal rejects with AUTH_ASSERTION_INVALID.
 *
 * @param payerId - The instructor's PayPal Merchant / payer ID (13-char
 *                  alphanumeric like "X4ALCFRTRXJLE"). NOT an email.
 * @returns The compact `header.payload.` JWT (signature segment empty — PayPal
 *          accepts unsigned because the request is already authenticated by
 *          the partner's bearer token).
 * @throws Error if `PAYPAL_CLIENT_ID` is not set (required for the `iss` claim).
 */
export function buildPayPalAuthAssertion(payerId: string): string {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "PAYPAL_CLIENT_ID is not set — required for PayPal-Auth-Assertion iss claim."
    );
  }
  const header = base64url(JSON.stringify({ alg: "none" }));
  // `iss` identifies the partner; `payer_id` identifies the merchant on whose
  // behalf the call is made. Both are mandatory.
  const payload = base64url(
    JSON.stringify({ iss: clientId, payer_id: payerId })
  );
  return `${header}.${payload}.`;
}

// ---------------------------------------------------------------------------
// Instructor OAuth — token refresh
// ---------------------------------------------------------------------------

/** Result returned from a successful refresh-token exchange. */
interface RefreshResult {
  /** The new (plaintext) access token — caller MUST encrypt before storing. */
  accessToken: string;
  /** Seconds until the new access token expires (default ~28800 / 8h). */
  expiresIn: number;
}

/**
 * Exchanges an instructor's stored refresh token for a new access token using
 * the PayPal Commerce Platform OAuth app. The new access token is also
 * persisted (encrypted) to `instructor_payment_accounts` so subsequent calls
 * can reuse it without round-tripping PayPal.
 *
 * Side effects: UPDATE on `instructor_payment_accounts.access_token` and
 * `connected_at` for the matching account row.
 *
 * @param supabase - Server-side Supabase client (must have UPDATE access — use
 *                   the admin client when called outside an authenticated
 *                   instructor context).
 * @param accountId - The `instructor_payment_accounts.id` of the row to refresh.
 * @param encryptedRefreshToken - The encrypted refresh token currently stored
 *                                in `instructor_payment_accounts.refresh_token`.
 * @returns The new plaintext access token + its lifetime.
 * @throws Error if the refresh exchange fails or required envs are missing.
 */
export async function refreshInstructorPayPalToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>,
  accountId: string,
  encryptedRefreshToken: string
): Promise<RefreshResult> {
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required to refresh instructor tokens."
    );
  }

  const refreshToken = decryptToken(encryptedRefreshToken);
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const res = await fetch(`${getPayPalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `PayPal token refresh failed (${res.status}): ${errText}`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  // Persist the new access token encrypted so subsequent invoice/refund calls
  // do not have to refresh again until the new token expires.
  await supabase
    .from("instructor_payment_accounts")
    .update({
      access_token: encryptToken(data.access_token),
      connected_at: new Date().toISOString(),
    })
    .eq("id", accountId);

  return { accessToken: data.access_token, expiresIn: data.expires_in };
}
