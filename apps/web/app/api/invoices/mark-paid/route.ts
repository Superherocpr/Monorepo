/**
 * POST /api/invoices/mark-paid
 * Called by: InvoiceDetailClient (Mark as Paid confirmation)
 * Auth: Instructor (own invoice only) or super admin
 *
 * Validates the caller and ownership, then delegates the actual mark-paid
 * work — the mark_invoice_paid() RPC call, instructor earnings recording,
 * payout trigger, and instructor/customer notification emails — to
 * markInvoicePaidAndNotify() (lib/invoice-actions.ts). The PayPal
 * paid-invoice webhook calls the same shared function, so a manual click and
 * an automatic PayPal payment detection behave identically.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { markInvoicePaidAndNotify } from "@/lib/invoice-actions";

/** Type guard — ensures a value is a non-null object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  const authResult = await requireApiRole(["instructor", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

  // Ownership check — instructors may only mark their own invoices paid.
  // Fetched separately from markInvoicePaidAndNotify's own lookup so this
  // route can enforce authorization before any state-changing work happens.
  const { data: invoiceOwnership } = await adminClient
    .from("invoices")
    .select("id, instructor_id")
    .eq("id", invoiceId)
    .single();

  if (!invoiceOwnership) {
    return Response.json({ success: false, error: "Invoice not found" }, { status: 404 });
  }

  if (actor.effectiveRole === "instructor" && invoiceOwnership.instructor_id !== actor.user.id) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const result = await markInvoicePaidAndNotify(adminClient, {
    invoiceId,
    actorId: actor.user.id,
    source: "manual",
  });

  if (!result.success) {
    return Response.json({ success: false, error: result.error }, { status: result.status });
  }

  return Response.json({ success: true, paidAt: result.paidAt });
}
