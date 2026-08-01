/**
 * POST /api/paypal/create-manual-charge-order
 * Called by: admin session manual charge modal
 * Auth: Manager and super_admin only
 * Creates a PayPal order for a manually-entered amount using the business PayPal account.
 * Returns { orderId } for the client to submit card details against.
 */

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getPayPalAccessToken, getPayPalApiBase } from "@/lib/paypal";
import { requireApiRole } from "@/lib/auth/effective-role";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;

  const body = await request.json().catch(() => null);
  if (!isObject(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawAmount = body.amount;
  const amount = typeof rawAmount === "number" ? rawAmount : parseFloat(String(rawAmount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "A valid positive amount is required." }, { status: 400 });
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : "Manual card charge";

  const orderPayload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "USD",
          value: amount.toFixed(2),
        },
        description,
      },
    ],
  };

  const idempotencyKey = createHash("sha256")
    .update(`${amount.toFixed(2)}:${description}`)
    .digest("hex")
    .slice(0, 32);

  const accessToken = await getPayPalAccessToken();
  const response = await fetch(`${getPayPalApiBase()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `manual-charge-${idempotencyKey}`,
    },
    body: JSON.stringify(orderPayload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown PayPal error");
    console.error("[create-manual-charge-order] PayPal create order failed:", errorText);
    return NextResponse.json({ error: "Failed to create PayPal order" }, { status: 502 });
  }

  const data = (await response.json()) as { id?: string };
  if (!data.id) {
    return NextResponse.json({ error: "PayPal order ID missing" }, { status: 502 });
  }

  return NextResponse.json({ orderId: data.id });
}
