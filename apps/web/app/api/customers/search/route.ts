/**
 * GET /api/customers/search
 * Called by: CustomersClient — debounced search input
 * Auth: Manager and super_admin only (verified server-side)
 * Queries profiles by name, email, or phone and returns the decorated list
 * with pre-computed booking and cert counts for client-side filter use.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { floatingNow } from "@/lib/business-time";
import {
  CUSTOMER_ACTIVITY_SELECT,
  summarizeCustomerActivity,
  type CustomerActivityRow,
} from "@/lib/customer-directory";

/**
 * Handles customer search requests from the admin customers page.
 * Query params:
 *   q    — search term (min 2 chars to activate server search)
 *   cert — cert status filter forwarded to client-side post-processing
 *   booking — booking filter forwarded to client-side post-processing
 * @param request - Incoming GET request with URLSearchParams.
 */
export async function GET(request: Request) {

  // ── Auth & role check ──────────────────────────────────────────────────────
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

  // ── Query params ───────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";

  // ── Database query ─────────────────────────────────────────────────────────
  // CUSTOMER_ACTIVITY_SELECT carries the FK hints the bookings join needs —
  // see lib/customer-directory.ts.
  let dbQuery = adminClient
    .from("profiles")
    .select(
      `id, first_name, last_name, email, phone, created_at, archived, ${CUSTOMER_ACTIVITY_SELECT}`
    )
    .eq("role", "customer")
    .order("last_name", { ascending: true })
    .limit(100);

  // Only apply the text search if the query is at least 2 characters long —
  // single characters produce too many false positives to be useful.
  if (query.length >= 2) {
    dbQuery = dbQuery.or(
      `first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`
    );
  }

  const { data: customers, error } = await dbQuery;

  if (error) {
    return Response.json({ error: "Search failed" }, { status: 500 });
  }

  // ── Compute per-customer meta ──────────────────────────────────────────────
  // Floating space: class times are wall-clock values since migration 0060.
  const now = new Date(floatingNow());

  const customersWithMeta = (customers ?? []).map((customer) => ({
    id: customer.id,
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    created_at: customer.created_at,
    archived: customer.archived,
    ...summarizeCustomerActivity(customer as unknown as CustomerActivityRow, now),
  }));

  return Response.json({ customers: customersWithMeta });
}
