/**
 * POST /api/promo-codes/validate
 * Called by: book/payment page when a customer applies a promo code.
 * Auth: None — public endpoint; no user state needed.
 *
 * Validates that a promo code exists, is active, has not expired, applies to the
 * requested session, and does not produce a discount exceeding the session price.
 * Returns the discount breakdown so the UI can preview the final price.
 *
 * Price is always resolved server-side from the session record — the client
 * cannot supply or override it.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePromoDiscount } from "@/lib/promo-codes";
import { getTeamBookingByShareToken } from "@/lib/team-bookings";
import { getSessionPricing } from "@/lib/session-pricing";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export type PromoValidateResult = {
  valid: true;
  discountType: "fixed" | "percent" | "free";
  discountValue: number;
  originalPrice: number;
  discountAmount: number;
  finalPrice: number;
  code: string;
};

export type PromoValidateError = {
  valid: false;
  error: string;
};

export type PromoValidateResponse = PromoValidateResult | PromoValidateError;

/**
 * Validates a promo code for a given session and returns the discount breakdown.
 * @param request - JSON body with { code: string, sessionId: string }
 * @returns PromoValidateResult on success or PromoValidateError on failure
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return NextResponse.json<PromoValidateError>(
      { valid: false, error: "Invalid request" },
      { status: 400 }
    );
  }

  const { code, sessionId, teamShareToken } = body;

  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json<PromoValidateError>(
      { valid: false, error: "Promo code is required" },
      { status: 400 }
    );
  }

  const isTeamSignup = typeof teamShareToken === "string" && teamShareToken.length > 0;

  if (!isTeamSignup && typeof sessionId !== "string") {
    return NextResponse.json<PromoValidateError>(
      { valid: false, error: "Session ID is required" },
      { status: 400 }
    );
  }

  const supabase = await createAdminClient();

  // ── Team signups price against the negotiated per-seat rate ───────────────
  // Without this the quote would be based on the catalog price while checkout
  // charges the team rate, and the resulting mismatch would reject every
  // promo-coded team signup at the amount-verification step.
  let teamPricePerSeat: number | null = null;
  let resolvedSessionId = sessionId as string;

  if (isTeamSignup) {
    const team = await getTeamBookingByShareToken(supabase, teamShareToken as string);
    if (!team) {
      return NextResponse.json<PromoValidateError>(
        { valid: false, error: "This signup link is not valid." },
        { status: 404 }
      );
    }
    if (team.paymentMode !== "per_seat") {
      return NextResponse.json<PromoValidateError>(
        { valid: false, error: "This class is already paid for by your employer." },
        { status: 409 }
      );
    }
    resolvedSessionId = team.sessionId;
    teamPricePerSeat = team.pricePerSeat;
  }

  // ── Resolve session price (authoritative, never from client) ──────────────
  // getSessionPricing() applies the instructor's session-level discount_percent
  // BEFORE the promo code is applied — this must match the price basis used by
  // create-booking-order/confirm/confirm-free, or a promo code that looks valid
  // here would get rejected as a price mismatch at checkout.
  const pricing = await getSessionPricing(supabase, resolvedSessionId, { teamPricePerSeat });

  if (!pricing.found) {
    console.error("[promo-codes/validate] Session pricing lookup failed:", pricing.error);
    const status = pricing.error === "Session not found" ? 404 : 500;
    return NextResponse.json<PromoValidateError>({ valid: false, error: pricing.error }, { status });
  }

  const originalPrice = pricing.basePrice;

  // ── Validate and resolve the promo code ───────────────────────────────────
  const result = await resolvePromoDiscount(supabase, code, resolvedSessionId, originalPrice);

  if (!result.valid) {
    return NextResponse.json<PromoValidateError>({ valid: false, error: result.error });
  }

  return NextResponse.json<PromoValidateResult>({
    valid: true,
    discountType: result.discountType,
    discountValue: result.discountValue,
    originalPrice,
    discountAmount: result.discountAmount,
    finalPrice: result.finalPrice,
    code: result.code,
  });
}
