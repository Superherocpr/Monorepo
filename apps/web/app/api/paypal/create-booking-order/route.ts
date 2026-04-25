/**
 * POST /api/paypal/create-booking-order
 * Called by: book/payment page (PayPalOneTimePaymentButton createOrder callback)
 * Auth: None required — creates a pending PayPal order that the buyer approves
 *
 * Accepts session ID, price, and class name. Resolves payment routing server-side
 * (instructor PayPal vs. business PayPal) and creates a PayPal order in CAPTURE
 * intent. When routing to an instructor, includes the PayPal-Auth-Assertion header
 * to direct funds to their merchant account. Returns { orderId } to the client.
 *
 * Actual capture and booking creation happen in /api/bookings/confirm after approval.
 *
 * Security: instructorPayPalAccountId is ALWAYS resolved server-side from the
 * sessionId — the client cannot supply or override the merchant ID.
 */

import { NextResponse } from "next/server";
import { getPayPalAccessToken } from "@/lib/paypal";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePaymentRouting } from "@/lib/resolve-payment-routing";

const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Base64url-encodes a string (RFC 4648 §5) — the encoding used by PayPal's
 * PayPal-Auth-Assertion JWT-style header.
 * @param input - The raw string to encode.
 */
function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { amount, className, sessionId } = body;

  if (
    typeof amount !== "number" ||
    amount <= 0 ||
    typeof className !== "string" ||
    typeof sessionId !== "string"
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // ── Resolve routing — never trust client input for merchant ID ─────────
  const supabase = await createAdminClient();
  const routing = await resolvePaymentRouting(supabase, sessionId);

  // ── Get business PayPal access token (always — required to create the order) ──
  const accessToken = await getPayPalAccessToken();

  const orderPayload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "USD",
          value: amount.toFixed(2),
        },
        description: `SuperHeroCPR — ${className}`,
      },
    ],
  };

  // ── Build request headers ──────────────────────────────────────────────
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };

  // If routing to instructor, add PayPal-Auth-Assertion to direct payment to
  // their merchant account. The payer_id MUST come from the database (resolved
  // above) — never from the client. The header is an unsigned JWT (alg: "none")
  // which PayPal accepts because the request is already authenticated via the
  // partner's bearer token.
  if (routing.instructorPayPalAccountId) {
    const assertionHeader = base64url(JSON.stringify({ alg: "none" }));
    const assertionPayload = base64url(
      JSON.stringify({ payer_id: routing.instructorPayPalAccountId })
    );
    headers["PayPal-Auth-Assertion"] = `${assertionHeader}.${assertionPayload}.`;
  }

  const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(orderPayload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown PayPal error");
    console.error("PayPal create booking order failed:", errorText);
    return NextResponse.json({ error: "Failed to create PayPal order" }, { status: 502 });
  }

  const data = (await response.json()) as { id?: string };

  if (!data.id) {
    return NextResponse.json({ error: "PayPal order ID missing" }, { status: 502 });
  }

  return NextResponse.json({ orderId: data.id });
}
