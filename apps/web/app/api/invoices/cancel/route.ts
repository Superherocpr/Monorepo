/**
 * POST /api/invoices/cancel
 * Called by: InvoiceDetailClient (Cancel Invoice confirmation)
 * Auth: Instructor (own invoice only) or super admin
 *
 * Cancels an invoice by:
 * 1. Calling the instructor's payment platform API to void the invoice there
 * 2. Only if that succeeds: updating our DB (status = cancelled, cancelled_at = now())
 * 3. Logging the cancellation action in invoice_activity_log
 *
 * If the platform API call fails, the DB is NOT updated and a clear error is returned.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { PaymentPlatform } from "@/types/users";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Calls the appropriate payment platform API to void/cancel the given invoice.
 * Returns true if the platform accepted the cancellation.
 * @param platform - The payment platform
 * @param platformInvoiceId - The invoice ID on the payment platform
 * @param accessToken - The instructor's OAuth access token for that platform
 */
async function cancelOnPlatform(
  platform: PaymentPlatform,
  platformInvoiceId: string,
  accessToken: string
): Promise<boolean> {
  if (platform === "paypal" || platform === "venmo_business") {
    // Venmo Business uses PayPal's invoicing API
    const res = await fetch(
      `https://api-m.paypal.com/v2/invoicing/invoices/${platformInvoiceId}/cancel`,
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
      }
    );
    return res.ok;
  }

  if (platform === "square") {
    const res = await fetch(
      `https://connect.squareup.com/v2/invoices/${platformInvoiceId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": "2024-01-18",
        },
        body: JSON.stringify({ version: 1 }),
      }
    );
    return res.ok;
  }

  if (platform === "stripe") {
    const res = await fetch(
      `https://api.stripe.com/v1/invoices/${platformInvoiceId}/void`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    return res.ok;
  }

  return false;
}

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || !["instructor", "super_admin"].includes(profile.role)) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

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
  if (profile.role === "instructor" && invoice.instructor_id !== profile.id) {
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

  // Fetch the instructor's active payment account for this platform
  const { data: paymentAccount } = await adminClient
    .from("instructor_payment_accounts")
    .select("access_token")
    .eq("instructor_id", invoice.instructor_id)
    .eq("platform", invoice.payment_platform)
    .eq("is_active", true)
    .single();

  if (!paymentAccount?.access_token) {
    return Response.json(
      {
        success: false,
        error:
          "No active payment account found for this platform. Cannot cancel.",
      },
      { status: 400 }
    );
  }

  // Call the platform API first — only update our DB if it succeeds
  const platformSuccess = await cancelOnPlatform(
    invoice.payment_platform as PaymentPlatform,
    invoice.platform_invoice_id,
    paymentAccount.access_token
  );

  if (!platformSuccess) {
    return Response.json(
      {
        success: false,
        error: `Failed to cancel invoice on ${invoice.payment_platform}. Please try again or contact support.`,
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
    actor_id: profile.id,
    action: "cancelled",
  });

  return Response.json({ success: true });
}
