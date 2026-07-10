/**
 * POST /api/paypal/create-booking-order
 * Called by: book/payment page (PayPalOneTimePaymentButton createOrder callback)
 * Auth: None required — creates a pending PayPal order that the buyer approves
 *
 * Accepts a session ID and an optional promo code. Re-fetches the class price/name
 * and validates the promo code (if any) server-side. Creates a PayPal order for
 * the final discounted amount against the SuperHeroCPR business PayPal account.
 * Returns { orderId, finalAmount } to the client.
 *
 * Actual capture and booking creation happen in /api/bookings/confirm after approval.
 *
 * Security: price is ALWAYS resolved server-side from the sessionId — the client
 * cannot supply or override the amount charged. Promo codes are re-validated here
 * against the DB; a tampered client code is rejected before an order is created.
 *
 * Note: free (100% off) bookings skip PayPal entirely and use /api/bookings/confirm-free.
 */

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  getPayPalAccessToken,
  getPayPalApiBase,
} from "@/lib/paypal";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePromoDiscount } from "@/lib/promo-codes";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Creates a PayPal order for a selected booking session using DB-owned price.
 * Applies a validated promo discount if a code is provided.
 * Side effects: PayPal order creation only; no payment is captured here.
 * @param request - JSON request containing sessionId and optional promoCode.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { sessionId, promoCode } = body;

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
  const baseAmount =
    typeof classType?.price === "number"
      ? classType.price
      : parseFloat(String(classType?.price ?? ""));
  const className = classType?.name?.trim() || "CPR Class";

  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
    return NextResponse.json({ error: "Session pricing unavailable" }, { status: 500 });
  }

  // ── Apply promo code discount (server-side re-validation) ─────────────────
  let finalAmount = baseAmount;
  let promoDescription = "";

  if (typeof promoCode === "string" && promoCode.trim()) {
    const promoResult = await resolvePromoDiscount(supabase, promoCode.trim(), sessionId, baseAmount);
    if (!promoResult.valid) {
      return NextResponse.json({ error: promoResult.error }, { status: 422 });
    }
    finalAmount = promoResult.finalPrice;
    promoDescription = ` (promo: ${promoResult.code})`;
  }

  // ── Get business PayPal access token (always — required to create the order) ──
  const accessToken = await getPayPalAccessToken();

  const orderPayload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "USD",
          value: finalAmount.toFixed(2),
        },
        description: `SuperHeroCPR — ${className}${promoDescription}`,
      },
    ],
  };

  // ── Build request headers ──────────────────────────────────────────────
  // Deterministic idempotency key — same session + final amount
  // collapses retries into a single PayPal order. Random per-request keys
  // (e.g. Date.now()) defeat the purpose of PayPal-Request-Id.
  const idempotencyKey = createHash("sha256")
    .update(`${sessionId}:${finalAmount.toFixed(2)}:business`)
    .digest("hex")
    .slice(0, 32);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "PayPal-Request-Id": `bk-${idempotencyKey}`,
  };

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

  return NextResponse.json({ orderId: data.id, finalAmount });
}
