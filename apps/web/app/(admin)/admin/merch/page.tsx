/**
 * Admin merch management page — /admin/merch
 * Super admin only. Manages products, variants, stock levels, and image uploads.
 * Data fetched server-side; all mutations handled by MerchAdminClient.
 * Used by: admin sidebar nav for super_admin role only.
 */

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { getAdminActor } from "@/lib/auth/effective-role";
import MerchAdminClient from "../../_components/MerchAdminClient";
import type { ProductWithVariants } from "@/types/merch";

/**
 * Server component for /admin/merch.
 * Redirects non-super-admin users (by effective role) to /admin.
 * Fetches all products with variants and passes them to the client component.
 */
export default async function AdminMerchPage() {
  // ── Auth guard (honors view-as) ────────────────────────────────────────────
  const actor = await getAdminActor();
  if (!actor || actor.effectiveRole !== "super_admin") redirect("/admin");

  const admin = await createAdminClient();

  // ── Fetch all products with variants ──────────────────────────────────────
  const { data: rawProducts, error } = await admin
    .from("products")
    .select(
      `
      id, name, description, price, image_url,
      active, low_stock_threshold, created_at,
      product_variants (
        id, size, stock_quantity
      )
    `
    )
    .order("name");

  if (error) {
    console.error("[AdminMerchPage] Failed to fetch products", error);
  }

  const products = (rawProducts ?? []) as unknown as ProductWithVariants[];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <MerchAdminClient initialProducts={products} actorId={actor.user.id} />
    </main>
  );
}
