/**
 * /dashboard/orders — Customer's full merch order history.
 * Fully server-rendered. Orders are fetched newest-first.
 * Auth guard is handled by app/(public)/dashboard/layout.tsx.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OrdersPageHeader from "./_components/OrdersPageHeader";
import OrdersList from "./_components/OrdersList";
import type { OrderRecord } from "@/types/orders";

export const metadata = {
  title: "My Orders | Superhero CPR",
};

/** Renders the orders page with a full history of the customer's merch purchases. */
export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin?redirect=/dashboard/orders");

  const { data: orders } = await supabase
    .from("orders")
    .select(
      `id, status, total_amount, tracking_number,
       shipping_name, shipping_address, shipping_city, shipping_state, shipping_zip,
       created_at,
       order_items (
         id, quantity, price_at_purchase,
         product_variants ( size, products ( name, image_url ) )
       )`
    )
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <OrdersPageHeader />
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Cast via unknown — Supabase infers array shapes for joined tables without generated DB types. */}
        <OrdersList orders={(orders ?? []) as unknown as OrderRecord[]} />
      </div>
    </div>
  );
}
