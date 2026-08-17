/**
 * POST /api/paypal/create-booking-order
 * Called by: book/payment page (PayPalOneTimePaymentButton createOrder callback)
 * Auth: None required — creates a pending PayPal order that the buyer approves
 *
 * Accepts a session ID, an optional promo code, and optional add-on ids. Re-fetches
 * the class price/name, validates the promo code (if any), and re-validates the
 * add-on selection against session_addons (migration 0036) — all server-side.
 * Creates a PayPal order for the final amount (class price − promo + add-ons)
 * against the SuperHeroCPR business PayPal account.
 * Returns { orderId, finalAmount } to the client.
 *
 * Also serves per-seat team/corporate signups: when `teamShareToken` is supplied,
 * the session and the negotiated per-seat rate are both resolved from the
 * team_bookings row that token points at, and add-ons are rejected (team
 * bookings never offer them). Capture then happens in
 * /api/team-bookings/[share_token]/signup rather than /api/bookings/confirm.
 *
 * Actual capture and booking creation happen in /api/bookings/confirm after approval.
 *
 * Security: price is ALWAYS resolved server-side from the sessionId — or, for a
 * team signup, from the token — so the client cannot supply or override the
 * amount charged. Promo codes are re-validated here against the DB; a tampered
 * client code is rejected before an order is created.
 *
 * Note: free (100% off) bookings skip PayPal entirely and use /api/bookings/confirm-free.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  getPayPalAccessToken,
  getPayPalApiBase,
} from "@/lib/paypal";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePromoDiscount } from "@/lib/promo-codes";
import { resolveAddonsSelection } from "@/lib/addon-checkout";
import { getSessionPricing } from "@/lib/session-pricing";
import { getTeamBookingByShareToken } from "@/lib/team-bookings";

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

  const { sessionId, promoCode, addonIds, teamShareToken } = body;

  const isTeamSignup = typeof teamShareToken === "string" && teamShareToken.length > 0;

  if (!isTeamSignup && typeof sessionId !== "string") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (addonIds !== undefined && (!Array.isArray(addonIds) || !addonIds.every((id) => typeof id === "string"))) {
    return NextResponse.json({ error: "addonIds must be an array of strings" }, { status: 400 });
  }

  const supabase = await createAdminClient();

  // ── Team signups: resolve the session and rate from the token ─────────────
  // Both come from the team_bookings row rather than the request body, so a
  // buyer can neither redirect the order at another class nor name their price.
  let teamPricePerSeat: number | null = null;
  let resolvedSessionId = sessionId as string;

  if (isTeamSignup) {
    const team = await getTeamBookingByShareToken(supabase, teamShareToken as string);

    if (!team) {
      return NextResponse.json({ error: "This signup link is not valid." }, { status: 404 });
    }
    if (team.paymentMode !== "per_seat") {
      return NextResponse.json(
        { error: "This class is paid for by the company — no payment is needed." },
        { status: 409 }
      );
    }
    if (team.closed) {
      return NextResponse.json({ error: "This class is not open for signups." }, { status: 409 });
    }
    if (Array.isArray(addonIds) && addonIds.length > 0) {
      return NextResponse.json(
        { error: "Add-ons are not available on team bookings." },
        { status: 422 }
      );
    }

    resolvedSessionId = team.sessionId;
    teamPricePerSeat = team.pricePerSeat;
  }

  // ── Resolve authoritative session details — never trust client price/copy ──
  // getSessionPricing() is the single source of truth for the instructor-
  // discounted base price, shared with promo-codes/validate, bookings/confirm,
  // and bookings/confirm-free — keeping this in one place is what prevents the
  // four routes from silently drifting apart on what a session "actually costs".
  const pricing = await getSessionPricing(supabase, resolvedSessionId, {
    teamPricePerSeat,
  });

  if (!pricing.found) {
    console.error("[create-booking-order] Session pricing lookup failed:", pricing.error);
    const status = pricing.error === "Session not found" ? 404 : 500;
    return NextResponse.json({ error: pricing.error }, { status });
  }

  if (pricing.basePrice <= 0) {
    return NextResponse.json({ error: "Session pricing unavailable" }, { status: 500 });
  }

  const baseAmount = pricing.basePrice;
  const className = pricing.className;

  // ── Apply promo code discount (server-side re-validation) ─────────────────
  let finalAmount = baseAmount;
  let promoDescription = "";

  if (typeof promoCode === "string" && promoCode.trim()) {
    const promoResult = await resolvePromoDiscount(supabase, promoCode.trim(), resolvedSessionId, baseAmount);
    if (!promoResult.valid) {
      return NextResponse.json({ error: promoResult.error }, { status: 422 });
    }
    finalAmount = promoResult.finalPrice;
    promoDescription = ` (promo: ${promoResult.code})`;
  }

  // ── Add selected add-ons (server-side re-validation against session_addons) ──
  let addonsDescription = "";
  if (Array.isArray(addonIds) && addonIds.length > 0) {
    const addonsResult = await resolveAddonsSelection(supabase, resolvedSessionId, addonIds as string[]);
    if (!addonsResult.valid) {
      return NextResponse.json({ error: addonsResult.error }, { status: 422 });
    }
    finalAmount = parseFloat((finalAmount + addonsResult.total).toFixed(2));
    if (addonsResult.addons.length > 0) {
      addonsDescription = ` + ${addonsResult.addons.map((a) => a.name).join(", ")}`;
    }
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
        description: `SuperHeroCPR — ${className}${promoDescription}${addonsDescription}`,
      },
    ],
  };

  // ── Build request headers ──────────────────────────────────────────────
  // The PayPal-Request-Id MUST be unique per checkout attempt. A previous
  // version derived it deterministically from session + amount, intending to
  // collapse retries into one PayPal order — but PayPal marks an order
  // COMPLETED after ANY capture attempt, including a DECLINED one, and then
  // returns that same consumed order for every retry within the request-id
  // retention window. Submitting card data against a consumed order fails
  // with a 4xx that the JS SDK surfaces as the opaque, unrecoverable
  // ERR_DEV_RECEIVED_CLIENT_ERROR_RESPONSE — bricking "card declined, try
  // another card" retries. Abandoned CREATED orders are harmless and expire
  // on their own; a stale reused order is not (THREAT-054 follow-on).
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "PayPal-Request-Id": `bk-${randomUUID()}`,
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
