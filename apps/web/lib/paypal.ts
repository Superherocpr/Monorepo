/**
 * PayPal shared helpers — credentials, environment URLs, and business access tokens.
 *
 * The business REST API app credentials are `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
 * + `PAYPAL_SECRET`. They are used to create checkout orders, capture payments,
 * create/send business invoices, issue refunds, and send PayPal Payouts.
 *
 * `PAYPAL_API_BASE` controls the environment (sandbox vs live) for ALL PayPal
 * calls in the codebase. Production deployments must set it explicitly so a
 * missing env var cannot silently send real customers through sandbox PayPal.
 * The browser-facing PayPal URL used for hosted invoice links is derived from
 * the same value via `getPayPalConnectBase()`.
 *
 * Server-side only. Never import this in client components.
 */

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
 * Returns the browser-facing PayPal base URL used for hosted invoice links.
 * Deriving this from PAYPAL_API_BASE keeps live and sandbox invoice links aligned.
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
