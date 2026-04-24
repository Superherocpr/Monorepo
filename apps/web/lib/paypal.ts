/**
 * PayPal server-side authentication helper.
 * Obtains a short-lived access token using the client credentials OAuth flow.
 * Used by: app/api/paypal/create-order/route.ts, app/api/orders/confirm/route.ts
 */

/**
 * Requests a PayPal access token using HTTP Basic auth with client credentials.
 * @returns Bearer token string for use in PayPal REST API calls.
 * @throws Error if NEXT_PUBLIC_PAYPAL_CLIENT_ID or PAYPAL_SECRET are missing, or the auth call fails.
 */
export async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";
  const clientSecret = process.env.PAYPAL_SECRET ?? "";
  const base =
    process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

  // Buffer.from produces standard Base64 — required by PayPal's Basic auth spec
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const response = await fetch(`${base}/v1/oauth2/token`, {
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
