/**
 * GET /api/paypal/client-token
 * Called by: book/payment page on mount, to initialize PayPalProvider with clientToken
 * Auth: None required — the token is scoped to the PayPal SDK session and carries
 *       no sensitive merchant data. It is required for the card-fields component to
 *       render hosted iframes.
 *
 * Calls PayPal's /v1/identity/generate-token server-side using business credentials
 * and returns the resulting short-lived client token (~1 hour TTL) to the browser.
 *
 * Security: The token does not grant write access to the merchant account and is
 * intentionally public-facing. No authentication gate needed.
 * THREAT-053 (2/10 low): endpoint can be called in bursts to consume PayPal rate
 * limits; log silently, no action required — PayPal's Identity API is generous
 * and the endpoint is lightweight.
 */

import { NextResponse } from "next/server";
import { getPayPalClientToken } from "@/lib/paypal";

/**
 * Generates and returns a PayPal client token for browser SDK initialization.
 * Side effects: one PayPal access-token fetch + one identity token fetch per call.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const clientToken = await getPayPalClientToken();
    return NextResponse.json({ clientToken });
  } catch (err) {
    console.error("[paypal/client-token] Failed to generate client token:", err);
    return NextResponse.json({ error: "Failed to generate PayPal client token" }, { status: 502 });
  }
}
