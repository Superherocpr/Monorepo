/**
 * POST /api/paypal/create-order
 * Called by: MerchClient.tsx (PayPalOneTimePaymentButton createOrder callback)
 * Auth: None required — creates a pending PayPal order that the buyer approves
 *
 * Accepts cart items and shipping totals, calls PayPal's Orders API to create
 * an order in CAPTURE intent, and returns { orderId } to the client.
 * The actual capture and fulfillment happen in /api/orders/confirm once approved.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getMerchPayPalAccessToken, getPayPalApiBase } from "@/lib/paypal";
import type { CartItem } from "@/lib/cart-store";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { cartItems, subtotal, shippingCost, total } = body;

  if (
    !Array.isArray(cartItems) ||
    cartItems.length === 0 ||
    typeof total !== "number"
  ) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const items = cartItems as CartItem[];
  const subtotalNum = typeof subtotal === "number" ? subtotal : parseFloat(String(subtotal));
  const shippingNum = typeof shippingCost === "number" ? shippingCost : parseFloat(String(shippingCost));
  const totalNum = typeof total === "number" ? total : parseFloat(String(total));

  const accessToken = await getMerchPayPalAccessToken();

  const orderPayload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "USD",
          value: totalNum.toFixed(2),
          breakdown: {
            item_total: {
              currency_code: "USD",
              value: subtotalNum.toFixed(2),
            },
            shipping: {
              currency_code: "USD",
              value: shippingNum.toFixed(2),
            },
          },
        },
        items: items.map((item) => ({
          name: `${item.productName} (${item.size})`,
          unit_amount: {
            currency_code: "USD",
            value: item.price.toFixed(2),
          },
          quantity: item.quantity.toString(),
          category: "PHYSICAL_GOODS",
        })),
      },
    ],
  };

  // Unique per attempt — NEVER derive this from cart contents. A deterministic
  // key made a retry after a failed/declined capture reuse the original PayPal
  // order, which PayPal marks COMPLETED after ANY capture attempt; the retry
  // then dies with the SDK's unrecoverable ERR_DEV_RECEIVED_CLIENT_ERROR_RESPONSE.
  // Same fix as create-booking-order / create-manual-charge-order (THREAT-054
  // follow-on). Abandoned CREATED orders expire harmlessly.
  const response = await fetch(`${getPayPalApiBase()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `merch-${randomUUID()}`,
    },
    body: JSON.stringify(orderPayload),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    console.error("[paypal/create-order] PayPal API error:", err);
    return NextResponse.json(
      { error: "Failed to create PayPal order" },
      { status: 502 }
    );
  }

  const order = (await response.json()) as { id: string };
  return NextResponse.json({ orderId: order.id });
}
