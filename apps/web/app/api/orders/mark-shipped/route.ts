/**
 * POST /api/orders/mark-shipped
 * Called by: OrdersAdminClient when admin marks an order as shipped.
 * Auth: super_admin only.
 * Updates order status to 'shipped', saves tracking number and optional carrier,
 * then sends a shipping confirmation email via Resend.
 * The DB is updated before the email is sent — email failure is non-fatal
 * (logged server-side, order remains shipped).
 */

import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { orderShippedEmail, OrderEmailItem } from "@/lib/emails";

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

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const { orderId, trackingNumber, carrier } = body;

  if (typeof orderId !== "string" || !orderId) {
    return Response.json({ success: false, error: "Order ID required." }, { status: 400 });
  }
  if (typeof trackingNumber !== "string" || !trackingNumber.trim()) {
    return Response.json({ success: false, error: "Tracking number is required." }, { status: 400 });
  }

  // ── Fetch order + customer for validation and email ─────────────────────────
  const { data: order } = await supabase
    .from("orders")
    .select(
      `id, status, total_amount, shipping_name, shipping_city, shipping_state,
       profiles!customer_id ( first_name, email ),
       order_items ( quantity, price_at_purchase, product_variants ( size, products ( name ) ) )`
    )
    .eq("id", orderId)
    .single();

  if (!order) {
    return Response.json({ success: false, error: "Order not found." }, { status: 404 });
  }
  if (order.status !== "paid") {
    return Response.json(
      { success: false, error: "Only paid orders can be marked as shipped." },
      { status: 400 }
    );
  }

  // ── Update order ───────────────────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "shipped",
      tracking_number: trackingNumber.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (updateError) {
    console.error("[mark-shipped] DB update failed:", updateError);
    return Response.json({ success: false, error: "Failed to update order." }, { status: 500 });
  }

  // ── Send shipping confirmation email (non-fatal) ────────────────────────────
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const customer = order.profiles as unknown as { first_name: string; email: string };
      const items = order.order_items as unknown as Array<{
        quantity: number;
        price_at_purchase: number;
        product_variants: { size: string; products: { name: string } };
      }>;

      const emailItems: OrderEmailItem[] = items.map((item) => ({
        productName: item.product_variants.products.name,
        size: item.product_variants.size,
        quantity: item.quantity,
        priceAtPurchase: item.price_at_purchase,
      }));

      const { subject, html } = orderShippedEmail({
        firstName: customer.first_name,
        trackingNumber: trackingNumber.trim(),
        carrier: typeof carrier === "string" && carrier.trim() ? carrier.trim() : null,
        items: emailItems,
        totalAmount: order.total_amount as number,
        shippingName: order.shipping_name,
        shippingCity: order.shipping_city,
        shippingState: order.shipping_state,
      });

      await resend.emails.send({
        from: "SuperHeroCPR <noreply@superherocpr.com>",
        to: customer.email,
        subject,
        html,
      });
    } catch (emailErr) {
      // Non-fatal — order is already marked shipped, just log the failure
      console.error("[mark-shipped] Shipping email failed:", emailErr);
    }
  }

  return Response.json({ success: true });
}
