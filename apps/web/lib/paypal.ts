/**
 * PayPal shared helpers — credentials, environment URLs, and business access tokens.
 *
 * Two PayPal merchant accounts are in use:
 *   - Main account (`NEXT_PUBLIC_PAYPAL_CLIENT_ID` + `PAYPAL_SECRET`): bookings,
 *     instructor payouts, and invoices.
 *   - Merch account (`NEXT_PUBLIC_PAYPAL_MERCH_CLIENT_ID` + `PAYPAL_MERCH_SECRET`):
 *     merch store checkout, captures, and refunds only.
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

// ---------------------------------------------------------------------------
// Capture fee breakdown
// ---------------------------------------------------------------------------

/** Real amounts PayPal reports for a completed capture, in USD. */
export interface PayPalCaptureFees {
  /** Gross amount captured from the customer. */
  grossAmount: number | null;
  /** PayPal's processing fee deducted from the capture. */
  paypalFee: number | null;
  /** Amount actually credited to the business account after the fee. */
  netAmount: number | null;
}

/** Reads a `{ value: "12.34" }` money object into a finite number, or null. */
function parseMoneyValue(money: unknown): number | null {
  if (typeof money !== "object" || money === null) return null;
  const raw = (money as { value?: unknown }).value;
  if (typeof raw !== "string") return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Extracts PayPal's own fee figures from a capture's `seller_receivable_breakdown`.
 *
 * PayPal returns this on the capture response at no extra API cost, which makes
 * it the only exact source for what a payment actually cost. Every field is null
 * when PayPal omits the breakdown — a null fee means "not tracked", never zero,
 * so revenue totals can tell measured amounts apart from unknown ones.
 *
 * @param breakdown - The `seller_receivable_breakdown` object from a capture, if present.
 * @returns Gross, fee, and net amounts, each null when unavailable.
 */
export function parseCaptureFees(breakdown: unknown): PayPalCaptureFees {
  if (typeof breakdown !== "object" || breakdown === null) {
    return { grossAmount: null, paypalFee: null, netAmount: null };
  }

  const record = breakdown as {
    gross_amount?: unknown;
    paypal_fee?: unknown;
    net_amount?: unknown;
  };

  return {
    grossAmount: parseMoneyValue(record.gross_amount),
    paypalFee: parseMoneyValue(record.paypal_fee),
    netAmount: parseMoneyValue(record.net_amount),
  };
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/** The five PayPal transmission headers required to verify a webhook event. */
export interface PayPalWebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

/**
 * Verifies a PayPal webhook event's signature via PayPal's
 * `/v1/notifications/verify-webhook-signature` endpoint, using the business
 * account's OAuth token and the caller-supplied webhook ID.
 *
 * Each PayPal webhook subscription gets its own unique ID scoped to its own
 * target URL, so the ID must be passed in by the route being called rather than
 * read from a single env var here: invoices use `PAYPAL_INVOICE_WEBHOOK_ID`,
 * payouts use `PAYPAL_PAYOUTS_WEBHOOK_ID`.
 *
 * This is the sole authentication mechanism for inbound PayPal webhooks —
 * there is no shared-secret header, so a valid signature is required before
 * acting on any webhook payload.
 *
 * @param headers - The five `paypal-*` transmission headers from the request.
 * @param webhookEvent - The parsed JSON body of the webhook request.
 * @param webhookId - The PayPal webhook subscription ID this event was sent to.
 * @returns True only if PayPal confirms the signature is valid for this webhook ID.
 */
export async function verifyPayPalWebhookSignature(
  headers: PayPalWebhookHeaders,
  webhookEvent: unknown,
  webhookId: string | undefined
): Promise<boolean> {
  if (!webhookId) {
    console.error(
      "[paypal] No webhook ID configured for this subscription — cannot verify webhook signatures."
    );
    return false;
  }

  const accessToken = await getPayPalAccessToken();
  const apiBase = getPayPalApiBase();

  const response = await fetch(`${apiBase}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transmission_id: headers.transmissionId,
      transmission_time: headers.transmissionTime,
      cert_url: headers.certUrl,
      auth_algo: headers.authAlgo,
      transmission_sig: headers.transmissionSig,
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    console.error(`[paypal] Webhook signature verification request failed (${response.status}):`, err);
    return false;
  }

  const data = (await response.json()) as { verification_status?: string };
  return data.verification_status === "SUCCESS";
}

/**
 * Requests a PayPal access token for the **merch store** REST API app.
 * Uses the separate merch merchant account (`NEXT_PUBLIC_PAYPAL_MERCH_CLIENT_ID`
 * + `PAYPAL_MERCH_SECRET`). Only used by merch checkout, capture, and refund routes.
 * @returns Bearer token string for use in PayPal REST API calls.
 * @throws Error if credentials are missing or the auth call fails.
 */
export async function getMerchPayPalAccessToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_MERCH_CLIENT_ID ?? "";
  const clientSecret = process.env.PAYPAL_MERCH_SECRET ?? "";

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
    cache: "no-store",
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`PayPal merch auth failed (${response.status}): ${err}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}
