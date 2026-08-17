/**
 * session-pricing.ts — server-side single source of truth for a session's price.
 * Used by: /api/promo-codes/validate, /api/paypal/create-booking-order,
 *          /api/bookings/confirm, /api/bookings/confirm-free
 *
 * A class_types row has a base price. An instructor may additionally set a
 * discount_percent (0-50) on an individual class_sessions row at creation
 * time — this is separate from, and applied before, any promo code discount.
 *
 * Every route that needs "what does this session actually cost" must go
 * through getSessionPricing() rather than re-querying class_types directly.
 * Previously each route computed this independently and one (promo-codes/validate)
 * forgot to apply discount_percent, which silently produced a different price
 * than the other three routes — causing legitimate promo-coded bookings on
 * discounted sessions to fail server-side amount verification. Centralizing
 * this closes off that entire class of drift.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Optional pricing overrides.
 *
 * `teamPricePerSeat` replaces the catalog-derived price for a signup made
 * through a team/corporate link, where staff negotiated a per-seat rate on a
 * call. It must always be resolved server-side from the team_bookings row the
 * share token points at — never accepted from the client, which would let a
 * buyer name their own price (THREAT-013).
 */
export interface SessionPricingOptions {
  teamPricePerSeat?: number | null;
}

/** Result when the session and its class type were found and price could be resolved. */
export interface SessionPricingFound {
  found: true;
  /** Instructor-discounted price — the authoritative base price BEFORE promo codes. */
  basePrice: number;
  /** The undiscounted class_types.price, for reference/display (e.g. strikethrough price). */
  rawPrice: number;
  /** The instructor's session-level discount, normalized to 0 when absent. */
  discountPercent: number;
  /** class_types.name, defaulted if missing. */
  className: string;
  /** class_sessions.instructor_id. */
  instructorId: string;
}

/** Result when the session, its class type, or its price could not be resolved. */
export interface SessionPricingNotFound {
  found: false;
  error: string;
}

export type SessionPricingResult = SessionPricingFound | SessionPricingNotFound;

/**
 * Resolves the authoritative, instructor-discount-adjusted base price for a session.
 * Never trust a client-supplied price — always call this server-side.
 * @param supabase  - Admin Supabase client (service role).
 * @param sessionId - UUID of the class_sessions row.
 * @param options   - Optional server-resolved overrides (see SessionPricingOptions).
 */
export async function getSessionPricing(
  supabase: SupabaseClient,
  sessionId: string,
  options: SessionPricingOptions = {}
): Promise<SessionPricingResult> {
  const { data: sessionRow, error } = await supabase
    .from("class_sessions")
    .select("instructor_id, discount_percent, class_types(name, price)")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("[getSessionPricing] Session lookup failed:", error);
    return { found: false, error: "Failed to load session" };
  }

  if (!sessionRow) {
    return { found: false, error: "Session not found" };
  }

  const row = sessionRow as {
    instructor_id: string;
    discount_percent: number | string | null;
    class_types:
      | { name: string | null; price: number | string | null }
      | Array<{ name: string | null; price: number | string | null }>
      | null;
  };

  const classType = Array.isArray(row.class_types) ? row.class_types[0] : row.class_types;

  const rawPrice =
    typeof classType?.price === "number"
      ? classType.price
      : parseFloat(String(classType?.price ?? ""));

  if (!Number.isFinite(rawPrice) || rawPrice < 0) {
    return { found: false, error: "Session pricing unavailable" };
  }

  const rawDiscountPercent = row.discount_percent;
  const parsedDiscountPercent =
    rawDiscountPercent == null
      ? 0
      : typeof rawDiscountPercent === "number"
        ? rawDiscountPercent
        : parseFloat(String(rawDiscountPercent));
  const discountPercent =
    Number.isFinite(parsedDiscountPercent) && parsedDiscountPercent > 0 ? parsedDiscountPercent : 0;

  // A team/corporate rate is the negotiated price for that link's buyers and
  // fully replaces the catalog price — the instructor's session-level discount
  // is not stacked on top, since the quoted rate already reflects the deal.
  const teamOverride = options.teamPricePerSeat;
  const hasTeamOverride =
    typeof teamOverride === "number" && Number.isFinite(teamOverride) && teamOverride >= 0;

  const basePrice = hasTeamOverride
    ? parseFloat(teamOverride.toFixed(2))
    : discountPercent > 0
      ? parseFloat((rawPrice * (1 - discountPercent / 100)).toFixed(2))
      : rawPrice;

  return {
    found: true,
    basePrice,
    rawPrice,
    discountPercent,
    className: classType?.name?.trim() || "CPR Class",
    instructorId: row.instructor_id,
  };
}
