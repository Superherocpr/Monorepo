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

      const itemsHtml = items
        .map((item) => {
          const pv = item.product_variants;
          return `<tr>
            <td style="padding:4px 8px">${pv.products.name}</td>
            <td style="padding:4px 8px">${pv.size}</td>
            <td style="padding:4px 8px;text-align:center">${item.quantity}</td>
            <td style="padding:4px 8px;text-align:right">$${item.price_at_purchase.toFixed(2)}</td>
          </tr>`;
        })
        .join("");

      const carrierLine =
        typeof carrier === "string" && carrier.trim()
          ? `<p><strong>Carrier:</strong> ${carrier.trim()}</p>`
          : "";

      await resend.emails.send({
        from: "SuperHeroCPR <noreply@superherocpr.com>",
        to: customer.email,
        subject: "Your SuperHeroCPR order has shipped!",
        html: `
          <h1>Your order is on the way, ${customer.first_name}!</h1>
          <p>Your SuperHeroCPR order has shipped.</p>
          <p><strong>Tracking number:</strong> ${trackingNumber.trim()}</p>
          ${carrierLine}
          <h3>Your order:</h3>
          <table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
            <thead>
              <tr style="background:#f3f4f6">
                <th style="padding:4px 8px;text-align:left">Product</th>
                <th style="padding:4px 8px;text-align:left">Size</th>
                <th style="padding:4px 8px;text-align:center">Qty</th>
                <th style="padding:4px 8px;text-align:right">Price</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <p style="margin-top:12px"><strong>Order Total: $${(order.total_amount as number).toFixed(2)}</strong></p>
          <p>Shipping to: ${order.shipping_name}, ${order.shipping_city}, ${order.shipping_state}</p>
          <p>— The SuperHeroCPR Team</p>
        `,
      });
    } catch (emailErr) {
      // Non-fatal — order is already marked shipped, just log the failure
      console.error("[mark-shipped] Shipping email failed:", emailErr);
    }
  }

  return Response.json({ success: true });
}
