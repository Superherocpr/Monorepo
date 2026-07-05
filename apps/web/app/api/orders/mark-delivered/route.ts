/**
 * POST /api/orders/mark-delivered
 * Called by: OrdersAdminClient when admin marks an order as delivered.
 * Auth: super_admin only.
 * Updates order status from 'shipped' to 'delivered'. No email is sent.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

export async function POST(request: Request) {

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

  const { orderId } = body;
  if (typeof orderId !== "string" || !orderId) {
    return Response.json({ success: false, error: "Order ID required." }, { status: 400 });
  }

  // ── Validate current status ─────────────────────────────────────────────────
  const { data: order } = await adminClient
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .single();

  if (!order) {
    return Response.json({ success: false, error: "Order not found." }, { status: 404 });
  }
  if (order.status !== "shipped") {
    return Response.json(
      { success: false, error: "Only shipped orders can be marked as delivered." },
      { status: 400 }
    );
  }

  // ── Update order ───────────────────────────────────────────────────────────
  const { error: updateError } = await adminClient
    .from("orders")
    .update({ status: "delivered", updated_at: new Date().toISOString() })
    .eq("id", orderId);

  if (updateError) {
    console.error("[mark-delivered] DB update failed:", updateError);
    return Response.json({ success: false, error: "Failed to update order." }, { status: 500 });
  }

  return Response.json({ success: true });
}
