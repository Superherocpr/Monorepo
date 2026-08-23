/**
 * GET /api/customers/lookup?q=
 * Called by: the "Add Student to Class" modal on /admin/sessions/[id].
 * Auth: instructor, manager, super_admin.
 *
 * A deliberately narrow customer finder for staff who need to look someone up
 * to book them, and nothing more. Distinct from /api/customers/search, which
 * backs the admin customers page: that route returns the first 100 profiles
 * with NO query at all, plus booking history and certification counts, and is
 * manager+ for that reason. Handing every instructor a full customer-list dump
 * is a wider grant than this feature needs.
 *
 * This route requires a real search term and caps results. It returns the same
 * decorated shape as /api/customers/search so the modal's table renders
 * identically whichever route fed it.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { floatingNow } from "@/lib/business-time";
import {
  CUSTOMER_ACTIVITY_SELECT,
  summarizeCustomerActivity,
  type CustomerActivityRow,
} from "@/lib/customer-directory";

/** Minimum characters before a search runs — shorter terms match half the table. */
const MIN_QUERY_LENGTH = 3;

/** Maximum rows returned. Enough to disambiguate a name, not enough to enumerate. */
const RESULT_LIMIT = 20;

/** Escapes PostgREST `or` filter metacharacters in a user-supplied term. */
function sanitizeTerm(term: string): string {
  return term.replace(/[,()\\]/g, " ").trim();
}

/**
 * Looks up customers by name, email, or phone.
 * @param request - GET request with a `q` query parameter.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireApiRole(["instructor", "manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const query = sanitizeTerm(searchParams.get("q") ?? "");

  // An empty result rather than an error: the modal calls this on every
  // keystroke and a half-typed name is not a client mistake.
  if (query.length < MIN_QUERY_LENGTH) {
    return Response.json({ customers: [] });
  }

  const supabase = await createAdminClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(`id, first_name, last_name, email, phone, ${CUSTOMER_ACTIVITY_SELECT}`)
    .eq("role", "customer")
    .eq("archived", false)
    .or(
      `first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`
    )
    .order("last_name", { ascending: true })
    .limit(RESULT_LIMIT);

  if (error) {
    console.error("[customers/lookup] Search failed:", error);
    return Response.json({ error: "Search failed." }, { status: 500 });
  }

  // Same decorated shape /api/customers/search returns, so the modal renders
  // identical columns whichever route fed it.
  // Floating space: class times are wall-clock values since migration 0060.
  const now = new Date(floatingNow());
  const customers = (data ?? []).map((customer) => ({
    id: customer.id,
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    ...summarizeCustomerActivity(customer as unknown as CustomerActivityRow, now),
  }));

  return Response.json({ customers });
}
