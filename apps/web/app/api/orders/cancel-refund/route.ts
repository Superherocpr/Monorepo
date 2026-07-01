/**
 * POST /api/orders/cancel-refund
 * Called by: OrdersAdminClient when super admin cancels and refunds an order.
 * Auth: super_admin only.
 * Issues a PayPal refund first — only updates order status if the refund succeeds.
 * Restores stock for each line item via the increment_stock RPC on success.
 * Supports partial refunds (minimum $0.01, maximum order total).
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getMerchPayPalAccessToken, getPayPalApiBase } from "@/lib/paypal";

/**
 * Refunds a paid merch order through PayPal, then cancels it locally and restores stock.
 * Side effects: PayPal refund, orders update, product_variants stock increment RPC.
 * @param request - JSON request containing orderId and refundAmount.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // ── Auth guard ──────────────────────────────────────────────────────────────
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

  const adminClient = await createAdminClient();

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const { orderId, refundAmount } = body;

  if (typeof orderId !== "string" || !orderId) {
    return Response.json({ success: false, error: "Order ID required." }, { status: 400 });
  }
  if (typeof refundAmount !== "number" || isNaN(refundAmount)) {
    return Response.json({ success: false, error: "Refund amount must be a number." }, { status: 400 });
  }

  // ── Fetch order ────────────────────────────────────────────────────────────
  const { data: order } = await adminClient
    .from("orders")
    .select("id, status, total_amount, paypal_transaction_id")
    .eq("id", orderId)
    .single();

  if (!order) {
    return Response.json({ success: false, error: "Order not found." }, { status: 404 });
  }
  if (order.status === "cancelled") {
    return Response.json({ success: false, error: "Order is already cancelled." }, { status: 400 });
  }
  if (order.status === "pending") {
    return Response.json(
      { success: false, error: "Pending orders cannot be cancelled via this route." },
      { status: 400 }
    );
  }

  // ── Validate refund amount ─────────────────────────────────────────────────
  const total = Number(order.total_amount);
  if (refundAmount < 0.01 || refundAmount > total) {
    return Response.json(
      { success: false, error: `Refund amount must be between $0.01 and $${total.toFixed(2)}.` },
      { status: 400 }
    );
  }

  // ── Issue PayPal refund (must succeed before DB update) ────────────────────
  if (order.paypal_transaction_id) {
    try {
      const token = await getMerchPayPalAccessToken();

      const paypalRes = await fetch(
        `${getPayPalApiBase()}/v2/payments/captures/${order.paypal_transaction_id}/refund`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: {
              value: refundAmount.toFixed(2),
              currency_code: "USD",
            },
            note_to_payer: "Refund from SuperHeroCPR",
          }),
          cache: "no-store",
        }
      );

      if (!paypalRes.ok) {
        const errText = await paypalRes.text().catch(() => "");
        console.error("[cancel-refund] PayPal refund failed:", errText);
        return Response.json(
          { success: false, error: "PayPal refund failed. Order has not been cancelled." },
          { status: 502 }
        );
      }
    } catch (err) {
      console.error("[cancel-refund] PayPal error:", err);
      return Response.json(
        { success: false, error: "Could not reach PayPal. Order has not been cancelled." },
        { status: 502 }
      );
    }
  }

  // ── Cancel the order in DB ─────────────────────────────────────────────────
  const cancelNote = `Cancelled and refunded $${refundAmount.toFixed(2)} on ${new Date().toLocaleDateString("en-US")}`;

  const { error: updateError } = await adminClient
    .from("orders")
    .update({
      status: "cancelled",
      notes: cancelNote,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (updateError) {
    // PayPal refund already issued — log this mismatch prominently
    console.error("[cancel-refund] CRITICAL: PayPal refund issued but DB update failed:", updateError);
    return Response.json(
      { success: false, error: "Refund was issued but order status could not be updated. Contact support." },
      { status: 500 }
    );
  }

  // ── Restore stock for each line item ───────────────────────────────────────
  const { data: items } = await adminClient
    .from("order_items")
    .select("variant_id, quantity")
    .eq("order_id", orderId);

  for (const item of items ?? []) {
    const { error: rpcError } = await adminClient.rpc("increment_stock", {
      variant_id: item.variant_id,
      amount: item.quantity,
    });
    if (rpcError) {
      // Non-fatal — stock mismatch is recoverable by admin via adjust-stock
      console.error("[cancel-refund] Stock restore failed for variant", item.variant_id, rpcError);
    }
  }

  return Response.json({ success: true, note: cancelNote });
}
