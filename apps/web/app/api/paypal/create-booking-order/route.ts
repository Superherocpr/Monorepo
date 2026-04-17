/**
 * POST /api/paypal/create-booking-order
 * Called by: book/payment page (PayPalOneTimePaymentButton createOrder callback)
 * Auth: None required — creates a pending PayPal order that the buyer approves
 *
 * Accepts session price, class name, and customer ID. Creates a PayPal order
 * in CAPTURE intent and returns { orderId } to the client.
 * Actual capture and booking creation happen in /api/bookings/confirm after approval.
 */

import { NextResponse } from "next/server";
import { getPayPalAccessToken } from "@/lib/paypal";

const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { amount, className } = body;

  if (typeof amount !== "number" || amount <= 0 || typeof className !== "string") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const accessToken = await getPayPalAccessToken();

  const orderPayload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "USD",
          value: amount.toFixed(2),
        },
        description: `Superhero CPR — ${className}`,
      },
    ],
  };

  const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(orderPayload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown PayPal error");
    console.error("PayPal create booking order failed:", errorText);
    return NextResponse.json({ error: "Failed to create PayPal order" }, { status: 502 });
  }

  const data = (await response.json()) as { id?: string };

  if (!data.id) {
    return NextResponse.json({ error: "PayPal order ID missing" }, { status: 502 });
  }

  return NextResponse.json({ orderId: data.id });
}
