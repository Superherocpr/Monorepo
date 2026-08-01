/**
 * POST /api/paypal/capture-manual-charge
 * Called by: admin session manual charge modal after PayPal card approval.
 * Auth: Manager and super_admin only
 * Captures the PayPal order and logs the completed payment without creating a booking.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { getPayPalAccessToken, getPayPalApiBase, evaluateCaptureOutcome } from "@/lib/paypal";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;

  const body = await request.json().catch(() => null);
  if (!isObject(body)) {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { paypalOrderId, customerId, amount, description, notes } = body;
  if (typeof paypalOrderId !== "string" || !paypalOrderId.trim()) {
    return Response.json({ success: false, error: "Missing PayPal order ID." }, { status: 400 });
  }
  if (typeof customerId !== "string" || !customerId.trim()) {
    return Response.json({ success: false, error: "Missing customer ID." }, { status: 400 });
  }

  const parsedAmount = typeof amount === "number" ? amount : parseFloat(String(amount));
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return Response.json({ success: false, error: "A valid positive amount is required." }, { status: 400 });
  }

  const descriptionText =
    typeof description === "string" && description.trim()
      ? description.trim()
      : "Manual card charge";
  const notesText = typeof notes === "string" && notes.trim() ? notes.trim() : null;

  const accessToken = await getPayPalAccessToken();
  const captureResponse = await fetch(
    `${getPayPalApiBase()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!captureResponse.ok) {
    const errorText = await captureResponse.text().catch(() => "Unknown capture error");
    console.error("[capture-manual-charge] PayPal capture failed:", errorText);
    return Response.json({ success: false, error: "Payment capture failed." }, { status: 502 });
  }

  const captureData = await captureResponse.json();
  const outcome = evaluateCaptureOutcome(captureData);

  if (!outcome.settled) {
    console.error("[capture-manual-charge] Capture did not settle:", {
      paypalOrderId,
      status: outcome.status,
      captureId: outcome.captureId,
    });

    return Response.json(
      {
        success: false,
        declined: true,
        error:
          outcome.status === "PENDING"
            ? "Payment is still pending review. No charge was recorded."
            : "Your card was declined and no payment was taken. Please try another card.",
      },
      { status: 402 }
    );
  }

  const paypalTransactionId = outcome.captureId;
  const fees = outcome.fees;

  const adminClient = await createAdminClient();
  const routingNote = `Manual register charge — ${descriptionText}`;
  const { error } = await adminClient.from("payments").insert({
    customer_id: customerId,
    amount: parsedAmount,
    status: "completed",
    payment_type: "online",
    paypal_transaction_id: paypalTransactionId,
    routing_note: routingNote,
    notes: notesText,
    paypal_fee_amount: fees.paypalFee,
    net_amount: fees.netAmount,
  });

  if (error) {
    console.error("[capture-manual-charge] Failed to insert payment record:", error);
    return Response.json({ success: false, error: "Failed to record payment." }, { status: 500 });
  }

  return Response.json({ success: true });
}
