/**
 * PATCH /api/orders/update-notes
 * Called by: OrdersAdminClient on notes textarea blur.
 * Auth: super_admin only.
 * Updates the internal fulfillment notes on an order. Not visible to customers.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

export async function PATCH(request: Request) {

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const { orderId, notes } = body;
  if (typeof orderId !== "string" || !orderId) {
    return Response.json({ success: false, error: "Order ID required." }, { status: 400 });
  }
  if (typeof notes !== "string") {
    return Response.json({ success: false, error: "Notes must be a string." }, { status: 400 });
  }

  // ── Update notes ───────────────────────────────────────────────────────────
  const { error: updateError } = await adminClient
    .from("orders")
    .update({
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (updateError) {
    console.error("[update-notes] DB update failed:", updateError);
    return Response.json({ success: false, error: "Failed to save notes." }, { status: 500 });
  }

  return Response.json({ success: true });
}
