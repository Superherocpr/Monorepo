/**
 * POST /api/orders/confirm
 * Called by: MerchClient.tsx (PayPalOneTimePaymentButton onApprove callback)
 * Auth: None required — PayPal order ID is verified by server-side capture
 *
 * 1. Validates required fields.
 * 2. Re-fetches every cart variant from the DB and recomputes the order total
 *    using authoritative DB prices. Rejects if the client-supplied total
 *    deviates from the recomputed total by more than $0.01 (THREAT-003).
 * 3. Captures the PayPal order server-side via PayPal REST API (v9 requirement).
 * 4. Atomically reserves stock for each item via decrement_stock_if_available
 *    RPC (THREAT-010). On failure, previously-reserved stock is released and
 *    the PayPal capture is refunded.
 * 5. Creates the orders + order_items records.
 * 6. Sends order confirmation email to the customer (best-effort via Resend).
 * 7. Sends order notification email to the business (best-effort via Resend).
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { getMerchPayPalAccessToken, getPayPalApiBase } from "@/lib/paypal";
import type { CartItem } from "@/lib/cart-store";

/** Flat shipping rate — mirrors NEXT_PUBLIC_SHIPPING_RATE used client-side. */
const SHIPPING_RATE = parseFloat(process.env.NEXT_PUBLIC_SHIPPING_RATE ?? "0");

/** Acceptable rounding tolerance when comparing client/server totals. */
const PRICE_TOLERANCE = 0.01;

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

/**
 * Issues a PayPal refund for a captured payment.
 * Used when post-capture validation fails (e.g. inventory ran out, amount
 * mismatch). Best-effort — caller logs failures for manual reconciliation.
 * @param captureId - The PayPal capture id returned from /capture.
 */
async function refundCapture(captureId: string): Promise<void> {
  const accessToken = await getMerchPayPalAccessToken();
  const res = await fetch(
    `${getPayPalApiBase()}/v2/payments/captures/${captureId}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Refund failed: ${res.status} ${txt}`);
  }
}

/**
 * Confirms a merch PayPal order, reserves stock, stores the order, and sends emails.
 * Side effects: PayPal capture/refund, stock RPCs, orders/order_items inserts, Resend emails.
 * @param request - JSON request containing PayPal order id, cart items, totals, and shipping info.
 */
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

  // ── Step 2: Server-side price recalculation (THREAT-003) ─────────────────
  // Never trust the client's price/total values — re-fetch each variant from
  // the DB and recompute. Reject if the client-supplied total drifts.
  for (const item of items) {
    if (
      typeof item.variantId !== "string" ||
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid cart item" },
        { status: 400 }
      );
    }
  }

  const supabase = await createClient();

  const variantIds = items.map((i) => i.variantId);
  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, size, price, stock_quantity, products(name)")
    .in("id", variantIds);

  if (!variants || variants.length !== variantIds.length) {
    return NextResponse.json(
      { success: false, error: "One or more items are no longer available." },
      { status: 409 }
    );
  }

  // Build an authoritative price/stock map keyed by variant id.
  const variantMap = new Map<
    string,
    { price: number; stock: number; productName: string; size: string }
  >();
  for (const v of variants as Array<{
    id: string;
    size: string;
    price: number | string;
    stock_quantity: number;
    products: { name: string } | { name: string }[] | null;
  }>) {
    const prod = Array.isArray(v.products) ? v.products[0] : v.products;
    variantMap.set(v.id, {
      price: typeof v.price === "number" ? v.price : parseFloat(String(v.price)),
      stock: v.stock_quantity,
      productName: prod?.name ?? "Item",
      size: v.size,
    });
  }

  let serverSubtotal = 0;
  for (const item of items) {
    const v = variantMap.get(item.variantId);
    if (!v) {
      return NextResponse.json(
        { success: false, error: "One or more items are no longer available." },
        { status: 409 }
      );
    }
    serverSubtotal += v.price * item.quantity;
  }

  const serverShipping = items.length > 0 ? SHIPPING_RATE : 0;
  const serverTotal = serverSubtotal + serverShipping;

  const clientTotal = typeof total === "number" ? total : parseFloat(String(total));
  if (
    !Number.isFinite(clientTotal) ||
    Math.abs(clientTotal - serverTotal) > PRICE_TOLERANCE
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Pricing has changed. Please refresh and try again.",
      },
      { status: 409 }
    );
  }

  // ── Step 3: Capture the PayPal order server-side ─────────────────────────
  // v9 API requires server-side capture — the client only provides orderId.
  // We capture AFTER price validation so a bad payload never charges the buyer.
  let paypalTransactionId: string;
  try {
    const accessToken = await getMerchPayPalAccessToken();
    const captureResponse = await fetch(
        `${getPayPalApiBase()}/v2/checkout/orders/${paypalOrderId}/capture`,
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
        payments?: { captures?: Array<{ id: string; amount?: { value: string } }> };
      }>;
    };

    const capture =
      captureData.purchase_units?.[0]?.payments?.captures?.[0];
    paypalTransactionId = capture?.id ?? paypalOrderId;

    // Defence in depth: verify PayPal captured the expected amount.
    // PayPal could in theory return a different value if order was modified.
    if (capture?.amount?.value) {
      const capturedAmount = parseFloat(capture.amount.value);
      if (
        Number.isFinite(capturedAmount) &&
        Math.abs(capturedAmount - serverTotal) > PRICE_TOLERANCE
      ) {
        console.error(
          "[orders/confirm] PayPal captured amount mismatch:",
          capturedAmount,
          "vs server total",
          serverTotal
        );
        // Best-effort refund — logged for manual review either way.
        await refundCapture(paypalTransactionId).catch((err) =>
          console.error("[orders/confirm] Refund after amount mismatch failed:", err)
        );
        return NextResponse.json(
          { success: false, error: "Payment amount mismatch — transaction reversed." },
          { status: 502 }
        );
      }
    }
  } catch (err) {
    console.error("[orders/confirm] PayPal capture error:", err);
    return NextResponse.json(
      { success: false, error: "PayPal capture error" },
      { status: 502 }
    );
  }

  // ── Step 4: Atomically reserve stock for each item (THREAT-010) ──────────
  // decrement_stock_if_available locks the row and decrements only if enough
  // stock remains. On failure we release previously-reserved stock and refund.
  const reserved: Array<{ variantId: string; quantity: number }> = [];
  for (const item of items) {
    const { data: ok, error: rpcErr } = await supabase.rpc(
      "decrement_stock_if_available",
      { p_variant_id: item.variantId, p_amount: item.quantity }
    );
    if (rpcErr || ok !== true) {
      // Release any stock we already reserved in this loop.
      for (const r of reserved) {
        await supabase.rpc("restore_stock", {
          p_variant_id: r.variantId,
          p_amount: r.quantity,
        });
      }
      // Refund the PayPal capture so the buyer is not charged for unavailable goods.
      await refundCapture(paypalTransactionId).catch((err) =>
        console.error("[orders/confirm] Refund after stock failure failed:", err)
      );
      const v = variantMap.get(item.variantId);
      return NextResponse.json(
        {
          success: false,
          error: `${v?.productName ?? "Item"} (${v?.size ?? ""}) sold out during checkout. Payment refunded.`,
        },
        { status: 409 }
      );
    }
    reserved.push({ variantId: item.variantId, quantity: item.quantity });
  }

  // ── Step 5: Resolve customer_id if logged in (optional) ──────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const customerId = user?.id ?? null;

  // ── Step 6: Create the order record using server-computed total ──────────
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      customer_id: customerId,
      status: "paid",
      total_amount: serverTotal,
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

  // ── Step 7: Create order_items using DB-authoritative prices ─────────────
  for (const item of items) {
    const v = variantMap.get(item.variantId)!;
    const { error: itemError } = await supabase.from("order_items").insert({
      order_id: order.id,
      variant_id: item.variantId,
      quantity: item.quantity,
      price_at_purchase: v.price,
    });
    if (itemError) {
      console.error("[orders/confirm] Failed to insert order item:", itemError);
      // Order already created — continue to avoid partial order state
    }
  }

  // ── Steps 7 & 8: Send emails (best-effort) ────────────────────────────────
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      "[orders/confirm] RESEND_API_KEY is not set — skipping email notifications"
    );
    return NextResponse.json({ success: true, orderId: order.id });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  // Build item list HTML — escape all user-supplied values before interpolation.
  // Prices use DB-authoritative values (variantMap) not client-supplied prices.
  const itemListHtml = items
    .map((item) => {
      const v = variantMap.get(item.variantId)!;
      const name = escapeHtml(`${v.productName} (${v.size})`);
      const lineTotal = (v.price * item.quantity).toFixed(2);
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
  const subtotalNum = serverSubtotal;
  const shippingCostNum = serverShipping;
  const totalNum = serverTotal;

  const emailPromises = [
    // Confirmation to customer
    resend.emails
      .send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: shippingInfo.email,
        subject: "Your SuperHeroCPR Order is Confirmed!",
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
          <p>Questions? Contact us at contact@superherocpr.com or (813) 966-3969.</p>
          <p>— The SuperHeroCPR Team</p>
        `,
      })
      .catch((err: unknown) =>
        console.error("[orders/confirm] Failed to send confirmation email:", err)
      ),

    // Notification to business
    resend.emails
      .send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: "contact@superherocpr.com",
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
