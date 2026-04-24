/**
 * Admin Orders page — `/admin/orders`
 * Access: super_admin only.
 *
 * Server component — resolves URL search params to build a filtered,
 * paginated query against the orders table. Passes result to OrdersAdminClient.
 *
 * Filter params: status, from, to, customer, page
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OrdersAdminClient, {
  type OrdersPageData,
} from "@/app/(admin)/_components/OrdersAdminClient";
import type { AdminOrderRecord } from "@/types/orders";

/** Valid order status values — used to sanitise the filter param. */
const VALID_STATUSES = new Set(["pending", "paid", "shipped", "delivered", "cancelled"]);

const PAGE_SIZE = 50;

/** Next.js 15+ — searchParams is a Promise. */
interface PageProps {
  searchParams: Promise<{
    status?: string;
    from?: string;
    to?: string;
    customer?: string;
    page?: string;
  }>;
}

/** Server component — handles auth, filtering, and pagination. */
export default async function AdminOrdersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { data: actorProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actorProfile || actorProfile.role !== "super_admin") {
    redirect("/admin");
  }

  // ── Resolve filter params ──────────────────────────────────────────────────
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const statusFilter = sp.status && VALID_STATUSES.has(sp.status) ? sp.status : null;
  const fromFilter = sp.from ?? null;
  const toFilter = sp.to ?? null;
  const customerFilter = sp.customer?.trim() ?? null;

  // ── Build query ────────────────────────────────────────────────────────────
  let query = supabase
    .from("orders")
    .select(
      `id, status, total_amount, paypal_transaction_id,
       shipping_name, shipping_address, shipping_city, shipping_state, shipping_zip,
       tracking_number, notes, created_at, updated_at,
       profiles!customer_id ( id, first_name, last_name, email ),
       order_items (
         id, quantity, price_at_purchase,
         product_variants (
           size,
           products ( name, image_url )
         )
       )`,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (statusFilter) query = query.eq("status", statusFilter);
  if (fromFilter) query = query.gte("created_at", fromFilter);
  if (toFilter) query = query.lte("created_at", `${toFilter}T23:59:59`);

  const { data: rawOrders, count } = await query;
  const orders = (rawOrders ?? []) as unknown as AdminOrderRecord[];

  // Customer filter is applied post-fetch since it requires searching joined profile fields.
  // For large datasets this should move to a DB function — acceptable at current scale.
  const filteredOrders = customerFilter
    ? orders.filter((o) => {
        const name = `${o.profiles.first_name} ${o.profiles.last_name}`.toLowerCase();
        const email = o.profiles.email.toLowerCase();
        const q = customerFilter.toLowerCase();
        return name.includes(q) || email.includes(q);
      })
    : orders;

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  const pageData: OrdersPageData = {
    orders: filteredOrders,
    totalCount: count ?? 0,
    totalPages,
    currentPage: page,
    filters: {
      status: statusFilter,
      from: fromFilter,
      to: toFilter,
      customer: customerFilter,
    },
  };

  return <OrdersAdminClient data={pageData} />;
}
