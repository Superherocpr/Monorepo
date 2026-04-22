/**
 * GET /api/customers/search
 * Called by: CustomersClient — debounced search input
 * Auth: Manager and super_admin only (verified server-side)
 * Queries profiles by name, email, or phone and returns the decorated list
 * with pre-computed booking and cert counts for client-side filter use.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Handles customer search requests from the admin customers page.
 * Query params:
 *   q    — search term (min 2 chars to activate server search)
 *   cert — cert status filter forwarded to client-side post-processing
 *   booking — booking filter forwarded to client-side post-processing
 * @param request - Incoming GET request with URLSearchParams.
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    (profile.role !== "manager" && profile.role !== "super_admin")
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Query params ───────────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";

  // ── Database query ─────────────────────────────────────────────────────────
  // Use explicit FK hints on bookings because the bookings table has three FKs
  // back to profiles (customer_id, created_by, cancelled_by). Without the hint
  // PostgREST cannot resolve the join and the query returns no data.
  let dbQuery = supabase
    .from("profiles")
    .select(
      `
      id, first_name, last_name, email, phone, created_at, archived,
      bookings!customer_id ( id, cancelled, class_sessions ( starts_at ) ),
      certifications!customer_id ( id, expires_at )
    `
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
  const now = new Date();

  const customersWithMeta = (customers ?? []).map((customer) => {
    const activeBookings = customer.bookings.filter(
      (b: { cancelled: boolean }) => !b.cancelled
    );
    const upcomingBookings = activeBookings.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (b: any) => {
        const session = Array.isArray(b.class_sessions)
          ? b.class_sessions[0]
          : b.class_sessions;
        return session && new Date(session.starts_at) >= now;
      }
    );
    const activeCerts = customer.certifications.filter(
      (c: { expires_at: string }) => new Date(c.expires_at) >= now
    );
    const expiringSoon = activeCerts.filter((c: { expires_at: string }) => {
      const days = Math.ceil(
        (new Date(c.expires_at).getTime() - now.getTime()) /
          (1000 * 60 * 60 * 24)
      );
      return days <= 90;
    });

    return {
      id: customer.id,
      first_name: customer.first_name,
      last_name: customer.last_name,
      email: customer.email,
      phone: customer.phone,
      created_at: customer.created_at,
      archived: customer.archived,
      upcomingBookingsCount: upcomingBookings.length,
      totalBookingsCount: activeBookings.length,
      activeCertsCount: activeCerts.length,
      hasExpiringSoon: expiringSoon.length > 0,
    };
  });

  return Response.json({ customers: customersWithMeta });
}
