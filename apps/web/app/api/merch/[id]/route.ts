/**
 * PATCH /api/merch/[id]
 * Called by: MerchAdminClient (Edit Product panel and activate/deactivate toggle).
 * Auth: super_admin only.
 * Partially updates a product record. Can update any combination of:
 *   name, description, price, low_stock_threshold, active, image_url, variants.
 * For variants:
 *   - New variants (id = null): inserted.
 *   - Removed variants (present in DB but absent from payload, stock = 0): deleted.
 *   - Existing variants: no stock update (handled by adjust-stock route).
 * Returns the updated product with all current variants.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Validates that a string is UUID-shaped (8-4-4-4-12 hex groups).
 * We don't enforce version/variant bits here — Postgres rejects malformed UUIDs.
 * The sole purpose is to block non-UUID strings from reaching the DB query.
 * @param id - The value to test.
 */
function isUUID(id: unknown): id is string {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: productId } = await params;

  if (!isUUID(productId)) {
    return Response.json({ success: false, error: "Invalid product id" }, { status: 400 });
  }

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  // ── Build product update ────────────────────────────────────────────────────
  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") update.name = body.name.trim();
  if ("description" in body)
    update.description =
      typeof body.description === "string" ? body.description.trim() || null : null;
  if (typeof body.price === "number") update.price = body.price;
  if (typeof body.low_stock_threshold === "number")
    update.low_stock_threshold = body.low_stock_threshold;
  if (typeof body.active === "boolean") update.active = body.active;
  if ("image_url" in body)
    update.image_url =
      typeof body.image_url === "string" ? body.image_url : null;

  if (Object.keys(update).length > 0) {
    const { error: updateError } = await supabase
      .from("products")
      .update(update)
      .eq("id", productId);

    if (updateError) {
      console.error("[PATCH /api/merch/[id]] Update failed:", updateError);
      return Response.json(
        { success: false, error: "Failed to update product." },
        { status: 500 }
      );
    }
  }

  // ── Handle variant changes ─────────────────────────────────────────────────
  if (Array.isArray(body.variants)) {
    const incomingVariants = body.variants as Array<{
      id: string | null;
      size: string;
      stock_quantity: number;
    }>;

    // Insert new variants (those without an id)
    const newVariants = incomingVariants.filter((v) => v.id === null);
    if (newVariants.length > 0) {
      const rows = newVariants.map((v) => ({
        product_id: productId,
        size: v.size,
        stock_quantity: Math.max(0, v.stock_quantity ?? 0),
      }));
      const { error: insertErr } = await supabase
        .from("product_variants")
        .insert(rows);
      if (insertErr) {
        console.error("[PATCH /api/merch/[id]] Variant insert failed:", insertErr);
      }
    }

    // Delete removed variants that have stock = 0
    // "Removed" means: they exist in DB but are absent from the incoming payload.
    const existingIds = new Set(
      incomingVariants.filter((v) => v.id !== null).map((v) => v.id as string)
    );
    const { data: dbVariants } = await supabase
      .from("product_variants")
      .select("id, stock_quantity")
      .eq("product_id", productId);

    const toDelete = (dbVariants ?? [])
      .filter((v) => !existingIds.has(v.id) && v.stock_quantity === 0)
      .map((v) => v.id);

    if (toDelete.length > 0) {
      await supabase.from("product_variants").delete().in("id", toDelete);
    }
  }

  // ── Return updated product with variants ───────────────────────────────────
  const { data: updatedProduct, error: fetchError } = await supabase
    .from("products")
    .select(
      "id, name, description, price, image_url, active, low_stock_threshold, created_at, product_variants ( id, size, stock_quantity )"
    )
    .eq("id", productId)
    .single();

  if (fetchError || !updatedProduct) {
    return Response.json(
      { success: false, error: "Product updated but could not be re-fetched." },
      { status: 500 }
    );
  }

  return Response.json({ success: true, product: updatedProduct });
}
