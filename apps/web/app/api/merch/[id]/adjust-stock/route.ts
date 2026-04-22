/**
 * POST /api/merch/[id]/adjust-stock
 * Called by: MerchAdminClient (Adjust Stock panel).
 * Auth: super_admin only.
 * Updates stock quantities for one or more product variants and logs each change
 * in the stock_adjustments table. Only variants that actually changed are logged.
 * Stock values are absolute (set to), not relative (add/subtract).
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Validates that a string is a plausible UUID.
 * @param id - The value to test.
 */
function isUUID(id: unknown): id is string {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  );
}

/** Shape of a single adjustment from the request body. */
interface AdjustmentItem {
  variantId: string;
  newQuantity: number;
}

export async function POST(
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

  const { adjustments, notes, actorId } = body;

  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return Response.json(
      { success: false, error: "adjustments array is required." },
      { status: 400 }
    );
  }

  // Validate actorId — must match the authenticated user for security
  if (!isUUID(actorId) || actorId !== user.id) {
    return Response.json({ success: false, error: "Invalid actorId." }, { status: 400 });
  }

  const safeNotes =
    typeof notes === "string" && notes.trim() ? notes.trim() : null;

  // ── Fetch current quantities for all variant ids ────────────────────────────
  const variantIds = (adjustments as AdjustmentItem[]).map((a) => a.variantId);

  const { data: currentVariants, error: fetchError } = await supabase
    .from("product_variants")
    .select("id, stock_quantity")
    .in("id", variantIds)
    .eq("product_id", productId); // Scope to the product to prevent cross-product tampering

  if (fetchError || !currentVariants) {
    return Response.json(
      { success: false, error: "Failed to fetch current stock." },
      { status: 500 }
    );
  }

  const currentMap = new Map(
    currentVariants.map((v) => [v.id, v.stock_quantity])
  );

  // ── Apply each adjustment ──────────────────────────────────────────────────
  const logRows: {
    variant_id: string;
    adjusted_by: string;
    previous_quantity: number;
    new_quantity: number;
    notes: string | null;
  }[] = [];

  for (const adj of adjustments as AdjustmentItem[]) {
    if (!isUUID(adj.variantId)) continue;
    const previousQty = currentMap.get(adj.variantId);
    if (previousQty === undefined) continue; // Variant not in this product

    const newQty = Math.max(0, Math.round(adj.newQuantity));
    if (newQty === previousQty) continue; // No change — skip

    const { error: updateErr } = await supabase
      .from("product_variants")
      .update({ stock_quantity: newQty })
      .eq("id", adj.variantId);

    if (updateErr) {
      console.error(`[adjust-stock] Failed to update variant ${adj.variantId}:`, updateErr);
      continue;
    }

    // Queue the log entry — only for successfully-updated variants
    logRows.push({
      variant_id: adj.variantId,
      adjusted_by: actorId,
      previous_quantity: previousQty,
      new_quantity: newQty,
      notes: safeNotes,
    });
  }

  // ── Write adjustment log ───────────────────────────────────────────────────
  if (logRows.length > 0) {
    const { error: logError } = await supabase
      .from("stock_adjustments")
      .insert(logRows);

    if (logError) {
      // Non-fatal — stock is already updated, log failure is acceptable
      console.error("[adjust-stock] Failed to log adjustments:", logError);
    }
  }

  return Response.json({ success: true, adjustedCount: logRows.length });
}
