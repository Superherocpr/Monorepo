/**
 * POST /api/merch
 * Called by: MerchAdminClient (Add Product panel).
 * Auth: super_admin only.
 * Creates a new product record and its variant records.
 * Returns the newly created product with variants.
 */

import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
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

  const { name, description, price, low_stock_threshold, active, image_url, variants } = body;

  // ── Validate required fields ───────────────────────────────────────────────
  if (!name || typeof name !== "string" || !name.trim()) {
    return Response.json({ success: false, error: "Product name is required." }, { status: 400 });
  }
  if (typeof price !== "number" || price < 0) {
    return Response.json({ success: false, error: "A valid price is required." }, { status: 400 });
  }
  if (typeof low_stock_threshold !== "number" || low_stock_threshold < 0) {
    return Response.json(
      { success: false, error: "Low stock threshold must be 0 or greater." },
      { status: 400 }
    );
  }
  if (!Array.isArray(variants)) {
    return Response.json({ success: false, error: "Variants must be an array." }, { status: 400 });
  }

  // ── Insert product ─────────────────────────────────────────────────────────
  const { data: product, error: productError } = await supabase
    .from("products")
    .insert({
      name: (name as string).trim(),
      description:
        description && typeof description === "string" ? description.trim() || null : null,
      price,
      low_stock_threshold,
      active: active !== false,
      image_url: image_url && typeof image_url === "string" ? image_url : null,
    })
    .select("id, name, description, price, image_url, active, low_stock_threshold, created_at")
    .single();

  if (productError || !product) {
    console.error("[POST /api/merch] Product insert failed:", productError);
    return Response.json(
      { success: false, error: "Failed to create product. Please try again." },
      { status: 500 }
    );
  }

  // ── Insert variants ────────────────────────────────────────────────────────
  // Only insert if variants are provided
  let insertedVariants: { id: string; size: string; stock_quantity: number }[] = [];
  if (variants.length > 0) {
    const variantRows = (variants as Array<Record<string, unknown>>).map((v) => ({
      product_id: product.id,
      size: String(v.size ?? ""),
      stock_quantity: typeof v.stock_quantity === "number" ? Math.max(0, v.stock_quantity) : 0,
    }));

    const { data: vData, error: variantError } = await supabase
      .from("product_variants")
      .insert(variantRows)
      .select("id, size, stock_quantity");

    if (variantError) {
      console.error("[POST /api/merch] Variant insert failed:", variantError);
      // Product was created — return it with empty variants rather than failing completely
    } else {
      insertedVariants = vData ?? [];
    }
  }

  return Response.json({
    success: true,
    product: { ...product, product_variants: insertedVariants },
  });
}
