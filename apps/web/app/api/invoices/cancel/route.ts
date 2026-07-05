/**
 * POST /api/invoices/cancel
 * Called by: InvoiceDetailClient (Cancel Invoice confirmation)
 * Auth: Instructor (own invoice only) or super admin
 *
 * Cancels an invoice by:
 * 1. Calling the business PayPal API to void the invoice there
 * 2. Only if that succeeds: updating our DB (status = cancelled, cancelled_at = now())
 * 3. Logging the cancellation action in invoice_activity_log
 *
 * If the platform API call fails, the DB is NOT updated and a clear error is returned.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { getPayPalAccessToken, getPayPalApiBase } from "@/lib/paypal";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Calls the business PayPal API to void/cancel the given invoice.
 * Returns true if the platform accepted the cancellation.
 * @param platformInvoiceId - The invoice ID on PayPal.
 */
async function cancelPayPalInvoice(platformInvoiceId: string): Promise<boolean> {
  const accessToken = await getPayPalAccessToken();
  const res = await fetch(
    `${getPayPalApiBase()}/v2/invoicing/invoices/${platformInvoiceId}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: "Invoice cancelled",
        note: "Cancelled via SuperHeroCPR",
      }),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    console.error("[invoices/cancel] PayPal cancel failed:", errorText);
  }

  return res.ok;
}

/**
 * Cancels an invoice on its payment platform, then records the cancellation locally.
 * Side effects: payment-platform invoice cancellation, invoice update, activity log insert.
 * @param request - JSON request containing invoiceId.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!isObject(body) || typeof body.invoiceId !== "string") {
    return Response.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { invoiceId } = body;

  // Auth check
  const authResult = await requireApiRole(["instructor", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

  const { data: invoice } = await adminClient
    .from("invoices")
    .select("id, instructor_id, platform_invoice_id, payment_platform, status")
    .eq("id", invoiceId)
    .single();

  if (!invoice) {
    return Response.json({ success: false, error: "Invoice not found" }, { status: 404 });
  }

  // Instructors may only cancel their own invoices
  if (actor.effectiveRole === "instructor" && invoice.instructor_id !== actor.user.id) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  if (invoice.status !== "sent") {
    return Response.json(
      { success: false, error: "Invoice is not in sent status" },
      { status: 400 }
    );
  }

  if (!invoice.platform_invoice_id) {
    return Response.json(
      { success: false, error: "Invoice has no platform invoice ID — cannot cancel." },
      { status: 400 }
    );
  }

  // Call the platform API first — only update our DB if it succeeds
  const platformSuccess = await cancelPayPalInvoice(invoice.platform_invoice_id);

  if (!platformSuccess) {
    return Response.json(
      {
        success: false,
          error: "Failed to cancel invoice in PayPal. Please try again or contact support.",
      },
      { status: 500 }
    );
  }

  // Platform confirmed — now update our DB
  await adminClient
    .from("invoices")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", invoiceId);

  await adminClient.from("invoice_activity_log").insert({
    invoice_id: invoiceId,
    actor_id: actor.user.id,
    action: "cancelled",
  });

  return Response.json({ success: true });
}
