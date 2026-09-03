/**
 * POST /api/class-requests/[id]/reject
 * Called by: admin class-request detail page
 * Auth: manager, super_admin only
 *
 * Rejects a pending class request by:
 *   1. Validating the reason (min 10 chars)
 *   2. Setting class_requests.status = 'rejected' and rejection_reason
 *   3. Emailing the customer with the rejection reason
 *
 * Returns { data: { ok: true } } on success.
 */

import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/send-email";
import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { classRequestRejectedCustomerEmail } from "@/lib/emails";

/** Route handler params from the dynamic [id] segment. */
interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Rejects a class request and notifies the customer with the reason.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const auth = await requireApiRole(["manager", "super_admin"]);
  if ("error" in auth) return auth.error;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ data: null, error: "Invalid JSON body" }, { status: 400 });
  }

  const { reason } = (body as Record<string, unknown>) ?? {};

  if (typeof reason !== "string" || reason.trim().length < 10) {
    return NextResponse.json(
      { data: null, error: "Rejection reason must be at least 10 characters" },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();

  // Load request with customer info
  const { data: classRequest } = await admin
    .from("class_requests")
    .select(`
      id, status, class_type_id,
      class_types ( name ),
      profiles ( first_name, email )
    `)
    .eq("id", id)
    .single();

  if (!classRequest) {
    return NextResponse.json(
      { data: null, error: "Class request not found" },
      { status: 404 }
    );
  }

  if (classRequest.status !== "pending") {
    return NextResponse.json(
      { data: null, error: "Only pending requests can be rejected" },
      { status: 409 }
    );
  }

  // Update the request status
  const { error: updateError } = await admin
    .from("class_requests")
    .update({ status: "rejected", rejection_reason: reason.trim() })
    .eq("id", id);

  if (updateError) {
    console.error("[class-requests/reject] Failed to update request:", updateError);
    return NextResponse.json(
      { data: null, error: "Failed to reject request" },
      { status: 500 }
    );
  }

  // ── Send rejection email to customer (best-effort) ────────────────────────
  // The rejection is already recorded; sendEmail guards and logs on its own.
  const classType = classRequest.class_types as unknown as { name: string } | null;
  const customer = classRequest.profiles as unknown as { first_name: string; email: string } | null;

  if (customer && classType) {
    const rejectedEmail = classRequestRejectedCustomerEmail({
      firstName: customer.first_name,
      className: classType.name,
      reason: reason.trim(),
    });

    await sendEmail({
      context: "class-requests/reject:customer",
      to: customer.email,
      subject: rejectedEmail.subject,
      html: rejectedEmail.html,
    });
  }

  return NextResponse.json({ data: { ok: true } });
}
