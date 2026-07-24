/**
 * addon-checkout.ts — server-side add-on resolution utility.
 * Used by: /api/sessions/[id]/addons, /api/paypal/create-booking-order,
 *          /api/bookings/confirm
 *
 * Centralizes the DB-authoritative validation logic so order creation and
 * capture enforce identical add-on eligibility with no duplication — mirrors
 * lib/promo-codes.ts's resolvePromoDiscount.
 *
 * An add-on is chargeable for a session only if an instructor has explicitly
 * opted the session into it (session_addons, migration 0036) and the addon is
 * still active. Client-submitted addon IDs are always re-checked against this
 * before any amount is trusted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** A single add-on resolved as valid for a session, with its authoritative price. */
export interface ResolvedAddon {
  id: string;
  name: string;
  price: number;
}

/** Result when every submitted add-on id is valid for the session. */
export interface AddonsResolvedValid {
  valid: true;
  addons: ResolvedAddon[];
  total: number;
}

/** Result when one or more submitted add-on ids are not valid for the session. */
export interface AddonsResolvedInvalid {
  valid: false;
  error: string;
}

export type AddonsResolveResult = AddonsResolvedValid | AddonsResolvedInvalid;

/**
 * Lists the add-ons an instructor has enabled for a session (active only).
 * Used to populate the checkout checklist — not itself a source of truth for
 * pricing at capture time (resolveAddonsSelection re-validates then).
 * @param supabase - Admin Supabase client (service role).
 * @param sessionId - UUID of the class_sessions row.
 */
export async function listSessionAddons(
  supabase: SupabaseClient,
  sessionId: string
): Promise<ResolvedAddon[]> {
  const { data, error } = await supabase
    .from("session_addons")
    .select("addons ( id, name, price, active )")
    .eq("session_id", sessionId);

  if (error) {
    console.error("[listSessionAddons] lookup failed:", error);
    return [];
  }

  return ((data ?? []) as unknown as { addons: { id: string; name: string; price: number | string; active: boolean } | null }[])
    .map((row) => row.addons)
    .filter((a): a is { id: string; name: string; price: number | string; active: boolean } => a !== null && a.active)
    .map((a) => ({
      id: a.id,
      name: a.name,
      price: typeof a.price === "number" ? a.price : parseFloat(String(a.price)),
    }));
}

/**
 * Validates a set of requested add-on ids against what's actually enabled for
 * the session, and computes the authoritative total.
 * @param supabase - Admin Supabase client (service role).
 * @param sessionId - UUID of the class_sessions row being purchased.
 * @param addonIds - Add-on ids the client wants to purchase (deduped internally).
 */
export async function resolveAddonsSelection(
  supabase: SupabaseClient,
  sessionId: string,
  addonIds: string[]
): Promise<AddonsResolveResult> {
  const requested = [...new Set(addonIds)];
  if (requested.length === 0) {
    return { valid: true, addons: [], total: 0 };
  }

  const available = await listSessionAddons(supabase, sessionId);
  const availableById = new Map(available.map((a) => [a.id, a]));

  const resolved: ResolvedAddon[] = [];
  for (const id of requested) {
    const match = availableById.get(id);
    if (!match) {
      return { valid: false, error: "One or more selected add-ons are no longer available for this session." };
    }
    resolved.push(match);
  }

  const total = parseFloat(resolved.reduce((sum, a) => sum + a.price, 0).toFixed(2));
  return { valid: true, addons: resolved, total };
}
