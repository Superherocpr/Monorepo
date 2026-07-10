/**
 * promo-codes.ts — server-side promo code resolution utility.
 * Used by: /api/paypal/create-booking-order, /api/bookings/confirm, /api/bookings/confirm-free
 *
 * Centralizes the DB-authoritative validation logic so both the order creation
 * and capture routes enforce identical discount rules with no duplication.
 *
 * Scope behaviour:
 *   all          — valid for any session, no junction table check needed
 *   session_type — looks up the session's class_type_id, checks promo_code_class_types
 *   session      — checks promo_code_sessions (original behaviour)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Result when the promo code is valid and a discount can be applied. */
export interface PromoDiscountValid {
  valid: true;
  code: string;
  discountType: "fixed" | "percent" | "free";
  discountValue: number;
  discountAmount: number;
  finalPrice: number;
}

/** Result when the promo code cannot be applied. */
export interface PromoDiscountInvalid {
  valid: false;
  error: string;
}

export type PromoDiscountResult = PromoDiscountValid | PromoDiscountInvalid;

/**
 * Validates a promo code against the DB and computes the final price.
 * Performs all checks: existence, active flag, expiry, scope eligibility,
 * and over-discount guard.
 *
 * @param supabase     - Admin Supabase client (service role).
 * @param code         - Raw promo code string from the client (will be uppercased/trimmed).
 * @param sessionId    - UUID of the class_sessions row being purchased.
 * @param basePrice    - Authoritative session price fetched from the DB by the caller.
 * @returns            - PromoDiscountValid with discount breakdown, or PromoDiscountInvalid with error.
 */
export async function resolvePromoDiscount(
  supabase: SupabaseClient,
  code: string,
  sessionId: string,
  basePrice: number
): Promise<PromoDiscountResult> {
  const normalizedCode = code.trim().toUpperCase();

  const { data: promoRow, error: promoError } = await supabase
    .from("promo_codes")
    .select("id, code, discount_type, discount_value, expires_at, active, scope")
    .eq("code", normalizedCode)
    .maybeSingle();

  if (promoError) {
    console.error("[resolvePromoDiscount] Promo lookup failed:", promoError);
    return { valid: false, error: "Failed to validate promo code" };
  }

  if (!promoRow) {
    return { valid: false, error: "Invalid promo code" };
  }

  const promo = promoRow as {
    id: string;
    code: string;
    discount_type: "fixed" | "percent" | "free";
    discount_value: number | string;
    expires_at: string | null;
    active: boolean;
    scope: "all" | "session_type" | "session";
  };

  if (!promo.active) {
    return { valid: false, error: "This promo code is no longer active" };
  }

  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return { valid: false, error: "This promo code has expired" };
  }

  // ── Scope check ───────────────────────────────────────────────────────────
  if (promo.scope === "session_type") {
    // Resolve the session's class type, then check the junction table
    const { data: sessionRow, error: sessionError } = await supabase
      .from("class_sessions")
      .select("class_type_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError || !sessionRow) {
      return { valid: false, error: "Failed to validate promo code" };
    }

    const classTypeId = (sessionRow as { class_type_id: string }).class_type_id;

    const { data: typeLink, error: typeLinkError } = await supabase
      .from("promo_code_class_types")
      .select("id")
      .eq("promo_code_id", promo.id)
      .eq("class_type_id", classTypeId)
      .maybeSingle();

    if (typeLinkError) {
      console.error("[resolvePromoDiscount] Class type link lookup failed:", typeLinkError);
      return { valid: false, error: "Failed to validate promo code" };
    }

    if (!typeLink) {
      return { valid: false, error: "This promo code is not valid for this session type" };
    }
  } else if (promo.scope === "session") {
    const { data: sessionLink, error: linkError } = await supabase
      .from("promo_code_sessions")
      .select("id")
      .eq("promo_code_id", promo.id)
      .eq("session_id", sessionId)
      .maybeSingle();

    if (linkError) {
      console.error("[resolvePromoDiscount] Session link lookup failed:", linkError);
      return { valid: false, error: "Failed to validate promo code" };
    }

    if (!sessionLink) {
      return { valid: false, error: "This promo code is not valid for this session" };
    }
  }
  // scope === 'all': no junction check needed

  // ── Compute discount ──────────────────────────────────────────────────────
  const discountValue =
    typeof promo.discount_value === "number"
      ? promo.discount_value
      : parseFloat(String(promo.discount_value));

  let discountAmount: number;

  if (promo.discount_type === "free") {
    discountAmount = basePrice;
  } else if (promo.discount_type === "percent") {
    discountAmount = parseFloat(((basePrice * discountValue) / 100).toFixed(2));
  } else {
    discountAmount = discountValue;
  }

  if (discountAmount > basePrice) {
    return {
      valid: false,
      error: "This promo code cannot be applied — the discount exceeds the session price",
    };
  }

  const finalPrice = parseFloat((basePrice - discountAmount).toFixed(2));

  return {
    valid: true,
    code: promo.code,
    discountType: promo.discount_type,
    discountValue,
    discountAmount,
    finalPrice,
  };
}
