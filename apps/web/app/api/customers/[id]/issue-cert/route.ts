/**
 * POST /api/customers/[id]/issue-cert
 * Called by: CustomerDetailClient — "Issue Cert" slide-in panel
 * Auth: Manager and super_admin only
 * Manually issues a certification to the customer. session_id is null
 * because manual certs are not tied to a class session.
 * Expiry is computed server-side from the cert type's validity_months.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Issues a certification manually to the specified customer.
 * @param request - POST request with JSON body:
 *   { certTypeId: string; issuedAt: string; certNumber?: string; notes?: string }
 * @param params - Route params containing the customer ID.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: customerId } = await params;
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!actor || (actor.role !== "manager" && actor.role !== "super_admin")) {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { certTypeId?: unknown; issuedAt?: unknown; certNumber?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { certTypeId, issuedAt, certNumber, notes } = body;

  if (typeof certTypeId !== "string" || !certTypeId) {
    return Response.json({ success: false, error: "Cert type is required." }, { status: 400 });
  }

  if (typeof issuedAt !== "string" || !issuedAt) {
    return Response.json({ success: false, error: "Issue date is required." }, { status: 400 });
  }

  // ── Fetch cert type for validity_months ────────────────────────────────────
  const { data: certType } = await supabase
    .from("cert_types")
    .select("id, validity_months")
    .eq("id", certTypeId)
    .eq("active", true)
    .single();

  if (!certType) {
    return Response.json({ success: false, error: "Cert type not found." }, { status: 404 });
  }

  // Compute expiry date server-side — client-supplied dates cannot be trusted.
  const issuedDate = new Date(issuedAt);
  if (isNaN(issuedDate.getTime())) {
    return Response.json({ success: false, error: "Invalid issue date." }, { status: 400 });
  }

  const expiresDate = new Date(issuedDate);
  expiresDate.setMonth(expiresDate.getMonth() + certType.validity_months);
  const expiresAt = expiresDate.toISOString().split("T")[0]; // Date only (YYYY-MM-DD)
  const issuedAtDate = issuedDate.toISOString().split("T")[0];

  // ── Insert certification ───────────────────────────────────────────────────
  const { error } = await supabase.from("certifications").insert({
    customer_id: customerId,
    cert_type_id: certTypeId,
    session_id: null, // Manually issued — no originating session
    issued_at: issuedAtDate,
    expires_at: expiresAt,
    cert_number:
      typeof certNumber === "string" && certNumber.trim().length > 0
        ? certNumber.trim()
        : null,
    notes:
      typeof notes === "string" && notes.trim().length > 0
        ? notes.trim()
        : null,
    reminder_sent: false,
  });

  if (error) {
    return Response.json(
      { success: false, error: "Failed to issue certification." },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
