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
 * `teamPricePerSeat` replaces the catalog price for a signup made through a
 * team/corporate link, where staff negotiated a per-seat rate on a call. The
 * session's discount_percent is still applied on top of it. It must always be resolved server-side from the team_bookings row the
 * share token points at — never accepted from the client, which would let a
 * buyer name their own price (THREAT-013).
 */
export interface SessionPricingOptions {
  teamPricePerSeat?: number | null;
}

/**
 * Normalizes a stored discount_percent (numeric column, may arrive as a string
 * or null) to a non-negative finite number, 0 when absent or unparseable.
 * @param raw - The raw class_sessions.discount_percent value.
 */
export function normalizeDiscountPercent(raw: number | string | null | undefined): number {
  if (raw == null) return 0;
  const parsed = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Applies a session-level percentage discount, rounded to cents. The one
 * formula behind both the price a team signup link displays and the price
 * checkout charges, so the two cannot drift apart.
 * @param price - Price before the discount.
 * @param discountPercent - Already-normalized discount, 0 for none.
 */
export function applyDiscountPercent(price: number, discountPercent: number): number {
  return discountPercent > 0 ? parseFloat((price * (1 - discountPercent / 100)).toFixed(2)) : price;
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

  const discountPercent = normalizeDiscountPercent(row.discount_percent);

  // A team/corporate rate replaces the catalog price as the starting point, and
  // the session's discount_percent is then taken off it like any other class.
  // Staff set that discount in the same form as the rate, so ignoring it here
  // meant the link and checkout both showed the undiscounted rate.
  const teamOverride = options.teamPricePerSeat;
  const hasTeamOverride =
    typeof teamOverride === "number" && Number.isFinite(teamOverride) && teamOverride >= 0;

  const basePrice = applyDiscountPercent(
    hasTeamOverride ? parseFloat(teamOverride.toFixed(2)) : rawPrice,
    discountPercent
  );

  return {
    found: true,
    basePrice,
    rawPrice,
    discountPercent,
    className: classType?.name?.trim() || "CPR Class",
    instructorId: row.instructor_id,
  };
}
