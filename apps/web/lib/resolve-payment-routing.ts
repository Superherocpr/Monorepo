/**
 * Payment routing resolver.
 * Determines where an online booking payment should be sent based on the
 * session's instructor preference and connected PayPal account.
 * Used by: app/api/paypal/create-booking-order/route.ts and
 *          app/api/bookings/confirm/route.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentRoutingResult } from "@/types/payments";

/** A row from instructor_payment_accounts as joined to profiles. */
interface InstructorPaymentAccount {
  platform: string;
  platform_account_id: string | null;
  is_active: boolean;
}

/** The shape of the instructor profile join from class_sessions. */
interface InstructorJoin {
  first_name: string;
  last_name: string;
  payment_routing: string;
  instructor_payment_accounts: InstructorPaymentAccount[] | null;
}

/**
 * Resolves where an online booking payment should be routed.
 * Reads only from the database — never trusts client input for routing decisions.
 *
 * Priority order:
 *   1. profiles.payment_routing = 'business' → business PayPal (intentional)
 *   2. payment_routing = 'instructor' AND active PayPal account → instructor PayPal
 *   3. payment_routing = 'instructor' AND no PayPal account → business PayPal (fallback)
 *
 * @param supabase - Server-side Supabase client (admin or anon both fine — read-only)
 * @param sessionId - UUID of the class_session being booked
 * @returns The merchant account ID (or null for business) and an audit note.
 */
export async function resolvePaymentRouting(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>,
  sessionId: string
): Promise<PaymentRoutingResult> {
  const { data: session } = await supabase
    .from("class_sessions")
    .select(`
      profiles!instructor_id (
        first_name,
        last_name,
        payment_routing,
        instructor_payment_accounts (
          platform,
          platform_account_id,
          is_active
        )
      )
    `)
    .eq("id", sessionId)
    .maybeSingle();

  // Cast the join — Supabase returns the many-to-one relation as a single object
  const instructor = (session?.profiles as unknown as InstructorJoin | null) ?? null;

  // Session not found or no instructor on record — fall back silently
  if (!instructor) {
    return {
      instructorPayPalAccountId: null,
      routingNote: "Routed to business PayPal — could not resolve session instructor",
    };
  }

  const instructorName = `${instructor.first_name} ${instructor.last_name}`;

  // Case 1: Routing explicitly set to business
  if (instructor.payment_routing === "business") {
    return {
      instructorPayPalAccountId: null,
      routingNote: "Routed to business PayPal — instructor payment routing set to business",
    };
  }

  // Case 2: Routing is instructor — find active PayPal account
  const accounts = instructor.instructor_payment_accounts ?? [];
  const paypalAccount = accounts.find(
    (acc) => acc.platform === "paypal" && acc.is_active && acc.platform_account_id
  );

  if (paypalAccount && paypalAccount.platform_account_id) {
    return {
      instructorPayPalAccountId: paypalAccount.platform_account_id,
      routingNote: `Routed to instructor PayPal — ${instructorName}`,
    };
  }

  // Case 3: Instructor routing ON but no PayPal connected — fall back
  return {
    instructorPayPalAccountId: null,
    routingNote: "Routed to business PayPal — instructor has no connected PayPal account",
  };
}
