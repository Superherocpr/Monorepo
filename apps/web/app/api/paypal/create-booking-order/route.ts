/**
 * POST /api/paypal/create-booking-order
 * Called by: book/payment page (PayPalOneTimePaymentButton createOrder callback)
 * Auth: None required — creates a pending PayPal order that the buyer approves
 *
 * Accepts a session ID, re-fetches the class price/name from the database,
 * resolves payment routing server-side (instructor PayPal vs. business PayPal),
 * and creates a PayPal order in CAPTURE intent. When routing to an instructor,
 * includes the PayPal-Auth-Assertion header to direct funds to their merchant
 * account. Returns { orderId } to the client.
 *
 * Actual capture and booking creation happen in /api/bookings/confirm after approval.
 *
 * Security: instructorPayPalAccountId is ALWAYS resolved server-side from the
 * sessionId — the client cannot supply or override the merchant ID.
 */

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  getPayPalAccessToken,
  getPayPalApiBase,
  buildPayPalAuthAssertion,
} from "@/lib/paypal";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePaymentRouting } from "@/lib/resolve-payment-routing";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Creates a PayPal order for a selected booking session using DB-owned price and routing.
 * Side effects: PayPal order creation only; no payment is captured here.
 * @param request - JSON request containing sessionId.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { sessionId } = body;

  if (typeof sessionId !== "string") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const supabase = await createAdminClient();

  // ── Resolve authoritative session details — never trust client price/copy ──
  const { data: sessionRow, error: sessionError } = await supabase
    .from("class_sessions")
    .select("class_types(name, price)")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    console.error("[create-booking-order] Session lookup failed:", sessionError);
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
  }

  if (!sessionRow) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const classTypeJoin = (
    sessionRow as {
      class_types:
        | { name: string | null; price: number | string | null }
        | Array<{ name: string | null; price: number | string | null }>
        | null;
    }
  ).class_types;
  const classType = Array.isArray(classTypeJoin) ? classTypeJoin[0] : classTypeJoin;
  const amount =
    typeof classType?.price === "number"
      ? classType.price
      : parseFloat(String(classType?.price ?? ""));
  const className = classType?.name?.trim() || "CPR Class";

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Session pricing unavailable" }, { status: 500 });
  }

  // ── Resolve routing — never trust client input for merchant ID ─────────
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
  // Deterministic idempotency key — same session + amount + routing target
  // collapses retries into a single PayPal order. Random per-request keys
  // (e.g. Date.now()) defeat the purpose of PayPal-Request-Id.
  const idempotencyKey = createHash("sha256")
    .update(
      `${sessionId}:${amount.toFixed(2)}:${routing.instructorPayPalAccountId ?? "business"}`
    )
    .digest("hex")
    .slice(0, 32);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "PayPal-Request-Id": `bk-${idempotencyKey}`,
  };

  // If routing to instructor, add PayPal-Auth-Assertion to direct payment to
  // their merchant account. The payer_id MUST come from the database (resolved
  // above) — never from the client. Per PayPal spec the JWT payload must
  // include BOTH `iss` (partner client_id) AND `payer_id` (merchant ID) —
  // `buildPayPalAuthAssertion` enforces this.
  if (routing.instructorPayPalAccountId) {
    headers["PayPal-Auth-Assertion"] = buildPayPalAuthAssertion(
      routing.instructorPayPalAccountId
    );
  }

  const response = await fetch(`${getPayPalApiBase()}/v2/checkout/orders`, {
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
