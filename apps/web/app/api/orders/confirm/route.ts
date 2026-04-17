/**
 * POST /api/orders/confirm
 * Called by: MerchClient.tsx (PayPalOneTimePaymentButton onApprove callback)
 * Auth: None required — PayPal order ID is verified by server-side capture
 *
 * 1. Validates required fields.
 * 2. Captures the PayPal order server-side via PayPal REST API (v9 requirement).
 * 3. Re-checks stock for all items (first-come-first-served, 409 if insufficient).
 * 4. Creates the orders record in Supabase.
 * 5. Creates all order_items records.
 * 6. Decrements stock_quantity on each product_variants row via atomic RPC.
 * 7. Sends order confirmation email to the customer (best-effort via Resend).
 * 8. Sends order notification email to the business (best-effort via Resend).
 *
 * Uses Supabase RPC for atomic stock decrement — see supabase/migrations/decrement_stock.sql
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { getPayPalAccessToken } from "@/lib/paypal";
import type { CartItem } from "@/lib/cart-store";

const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

// SHIPPING_RATE is handled client-side — not needed in this route

/** Escapes HTML special characters to prevent injection in email HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface ShippingInfo {
  name: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const {
    paypalOrderId,
    cartItems,
    shipping,
    subtotal,
    shippingCost,
    total,
  } = body;

  // ── Step 1: Validate required fields ──────────────────────────────────────
  if (
    typeof paypalOrderId !== "string" ||
    !paypalOrderId ||
    !Array.isArray(cartItems) ||
    cartItems.length === 0 ||
    !isObject(shipping) ||
    typeof shipping.email !== "string" ||
    !shipping.email.trim() ||
    typeof shipping.name !== "string" ||
    !shipping.name.trim() ||
    typeof shipping.address !== "string" ||
    !shipping.address.trim() ||
    typeof shipping.city !== "string" ||
    !shipping.city.trim() ||
    typeof shipping.state !== "string" ||
    !shipping.state.trim() ||
    typeof shipping.zip !== "string" ||
    !shipping.zip.trim()
  ) {
    return NextResponse.json(
      { success: false, error: "Missing required fields" },
      { status: 400 }
    );
  }

  const shippingInfo = shipping as unknown as ShippingInfo;
  const items = cartItems as CartItem[];

  // ── Step 2: Capture the PayPal order server-side ──────────────────────────
  // v9 API requires server-side capture — the client only provides orderId
  let paypalTransactionId: string;
  try {
    const accessToken = await getPayPalAccessToken();
    const captureResponse = await fetch(
      `${PAYPAL_API_BASE}/v2/checkout/orders/${paypalOrderId}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!captureResponse.ok) {
      const err = await captureResponse.text().catch(() => "");
      console.error("[orders/confirm] PayPal capture failed:", err);
      return NextResponse.json(
        { success: false, error: "PayPal capture failed" },
        { status: 502 }
      );
    }

    const captureData = (await captureResponse.json()) as {
      purchase_units?: Array<{
        payments?: { captures?: Array<{ id: string }> };
      }>;
    };

    paypalTransactionId =
      captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id ??
      paypalOrderId;
  } catch (err) {
    console.error("[orders/confirm] PayPal capture error:", err);
    return NextResponse.json(
      { success: false, error: "PayPal capture error" },
      { status: 502 }
    );
  }

  const supabase = await createClient();

  // ── Step 3: Re-check stock for all items ──────────────────────────────────
  for (const item of items) {
    if (typeof item.variantId !== "string" || typeof item.quantity !== "number") {
      return NextResponse.json(
        { success: false, error: "Invalid cart item" },
        { status: 400 }
      );
    }

    const { data: variant } = await supabase
      .from("product_variants")
      .select("stock_quantity")
      .eq("id", item.variantId)
      .single();

    if (!variant || variant.stock_quantity < item.quantity) {
      return NextResponse.json(
        {
          success: false,
          error: `${item.productName} (${item.size}) is no longer available in the requested quantity.`,
        },
        { status: 409 }
      );
    }
  }

  // ── Step 4: Resolve customer_id if logged in (optional) ──────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const customerId = user?.id ?? null;

  // ── Step 5: Create the order record ──────────────────────────────────────
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id: customerId,
      status: "paid",
      total_amount: typeof total === "number" ? total : parseFloat(String(total)),
      paypal_transaction_id: paypalTransactionId,
      shipping_name: shippingInfo.name.trim(),
      shipping_address: shippingInfo.address.trim(),
      shipping_city: shippingInfo.city.trim(),
      shipping_state: shippingInfo.state.trim(),
      shipping_zip: shippingInfo.zip.trim(),
    })
    .select("id")
    .single();

  if (orderError || !order) {
    console.error("[orders/confirm] Failed to create order:", orderError);
    return NextResponse.json(
      { success: false, error: "Failed to create order" },
      { status: 500 }
    );
  }

  // ── Step 6: Create order_items + decrement stock ──────────────────────────
  for (const item of items) {
    const { error: itemError } = await supabase.from("order_items").insert({
      order_id: order.id,
      variant_id: item.variantId,
      quantity: item.quantity,
      price_at_purchase: item.price,
    });

    if (itemError) {
      console.error("[orders/confirm] Failed to insert order item:", itemError);
      // Order is already created — continue to avoid partial order state
    }

    // Uses Supabase RPC for atomic stock decrement — greatest(..., 0) prevents negative stock
    await supabase.rpc("decrement_stock", {
      variant_id: item.variantId,
      amount: item.quantity,
    });
  }

  // ── Steps 7 & 8: Send emails (best-effort) ────────────────────────────────
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      "[orders/confirm] RESEND_API_KEY is not set — skipping email notifications"
    );
    return NextResponse.json({ success: true, orderId: order.id });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  // Build item list HTML — escape all user-supplied values before interpolation
  const itemListHtml = items
    .map((item) => {
      const name = escapeHtml(`${item.productName} (${item.size})`);
      const lineTotal = (item.price * item.quantity).toFixed(2);
      return `<tr><td>${name}</td><td>x${item.quantity}</td><td>$${lineTotal}</td></tr>`;
    })
    .join("");

  const safeName = escapeHtml(shippingInfo.name);
  const safeAddress = escapeHtml(shippingInfo.address);
  const safeCity = escapeHtml(shippingInfo.city);
  const safeState = escapeHtml(shippingInfo.state);
  const safeZip = escapeHtml(shippingInfo.zip);
  const safeEmail = escapeHtml(shippingInfo.email);
  const safeTransactionId = escapeHtml(paypalTransactionId);
  const subtotalNum =
    typeof subtotal === "number" ? subtotal : parseFloat(String(subtotal));
  const shippingCostNum =
    typeof shippingCost === "number"
      ? shippingCost
      : parseFloat(String(shippingCost));
  const totalNum =
    typeof total === "number" ? total : parseFloat(String(total));

  const emailPromises = [
    // Confirmation to customer
    resend.emails
      .send({
        from: "Superhero CPR <noreply@superherocpr.com>",
        to: shippingInfo.email,
        subject: "Your Superhero CPR Order is Confirmed!",
        html: `
          <h1>Order Confirmed!</h1>
          <p>Thanks for your order. Here's a summary:</p>
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
            <tbody>${itemListHtml}</tbody>
            <tfoot>
              <tr><td colspan="2">Subtotal</td><td>$${subtotalNum.toFixed(2)}</td></tr>
              <tr><td colspan="2">Shipping</td><td>${shippingCostNum > 0 ? "$" + shippingCostNum.toFixed(2) : "Free"}</td></tr>
              <tr><td colspan="2"><strong>Total</strong></td><td><strong>$${totalNum.toFixed(2)}</strong></td></tr>
            </tfoot>
          </table>
          <p><strong>Shipping to:</strong><br>
            ${safeName}<br>
            ${safeAddress}<br>
            ${safeCity}, ${safeState} ${safeZip}
          </p>
          <p>Transaction ID: ${safeTransactionId}</p>
          <p>Questions? Contact us at info@superherocpr.com or (813) 966-3969.</p>
          <p>— The Superhero CPR Team</p>
        `,
      })
      .catch((err: unknown) =>
        console.error("[orders/confirm] Failed to send confirmation email:", err)
      ),

    // Notification to business
    resend.emails
      .send({
        from: "Superhero CPR Website <noreply@superherocpr.com>",
        to: "info@superherocpr.com",
        subject: `New Merch Order — $${totalNum.toFixed(2)}`,
        html: `
          <h2>New merch order received</h2>
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
            <tbody>${itemListHtml}</tbody>
          </table>
          <p><strong>Ship to:</strong><br>
            ${safeName}<br>
            ${safeAddress}<br>
            ${safeCity}, ${safeState} ${safeZip}<br>
            ${safeEmail}
          </p>
          <p><strong>Total:</strong> $${totalNum.toFixed(2)}</p>
          <p><strong>PayPal Transaction:</strong> ${safeTransactionId}</p>
        `,
      })
      .catch((err: unknown) =>
        console.error("[orders/confirm] Failed to send business notification:", err)
      ),
  ];

  await Promise.all(emailPromises);

  return NextResponse.json({ success: true, orderId: order.id });
}
