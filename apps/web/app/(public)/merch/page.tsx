/**
 * /merch page — merchandise catalog with cart and PayPal checkout.
 * Server component. Fetches active products with variants, passes to MerchClient.
 */

import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import MerchHeroSection from "./_components/MerchHeroSection";
import MerchClient from "./_components/MerchClient";
import type { ProductWithVariants } from "@/types/merch";

export const metadata: Metadata = {
  title: "Merch",
  description:
    "Official SuperHeroCPR merchandise. Rep the mission and spread CPR awareness.",
};

/** Renders the full /merch page. */
export default async function MerchPage() {
  const supabase = await createClient();

  const { data: products } = await supabase
    .from("products")
    .select(`
      id,
      name,
      description,
      price,
      image_url,
      active,
      low_stock_threshold,
      created_at,
      product_variants (
        id,
        product_id,
        size,
        stock_quantity,
        created_at
      )
    `)
    .eq("active", true)
    .order("name");

  return (
    <main>
      <MerchHeroSection />
      <MerchClient products={(products ?? []) as ProductWithVariants[]} />
    </main>
  );
}
