/**
 * PATCH /api/certifications/[id]/ecard-code
 * Called by: CertECardCodeInput on the customer /dashboard/certifications page
 * Auth: Authenticated customer — must own the certification being updated
 * Updates only the cert_number (eCard code) on the caller's own certification.
 *
 * The service-role client is used because the certifications table has no
 * customer-facing write RLS policy. Ownership is enforced in two places:
 *   1. SELECT with customer_id = user.id to verify the cert exists and belongs to them
 *   2. UPDATE filtered by both id AND customer_id = user.id (belt-and-suspenders)
 * No other columns are touched.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";

/** Validates that a route param is a plausible UUID. */
function isValidUuid(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

/**
 * Updates the eCard code (cert_number) on a certification the caller owns.
 * Body: { certNumber: string } — must be a non-empty string, max 100 chars.
 * @param request - Incoming PATCH request with JSON body
 * @param params - Route params containing the certification UUID
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Validate route param ──────────────────────────────────────────────────
  const { id } = await params;
  if (!isValidUuid(id)) {
    return Response.json({ error: "Invalid certification ID." }, { status: 400 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { certNumber?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.certNumber !== "string" || body.certNumber.trim().length === 0) {
    return Response.json({ error: "certNumber must be a non-empty string." }, { status: 400 });
  }

  const certNumber = body.certNumber.trim();

  // Sanity-length cap — real AHA eCard codes are short alphanumeric strings
  if (certNumber.length > 100) {
    return Response.json({ error: "eCard code is too long." }, { status: 400 });
  }

  // ── Ownership check + update ──────────────────────────────────────────────
  // Service-role client required: no customer write policy exists on certifications.
  const adminSupabase = await createAdminClient();

  // Verify the cert exists AND belongs to this customer before touching it.
  // Returning 404 regardless of whether the cert exists prevents enumeration of
  // other customers' certification IDs.
  const { data: existing } = await adminSupabase
    .from("certifications")
    .select("id")
    .eq("id", id)
    .eq("customer_id", user.id)
    .single();

  if (!existing) {
    return Response.json({ error: "Certification not found." }, { status: 404 });
  }

  // Belt-and-suspenders: include customer_id in the UPDATE filter as well
  const { error: updateError } = await adminSupabase
    .from("certifications")
    .update({ cert_number: certNumber })
    .eq("id", id)
    .eq("customer_id", user.id);

  if (updateError) {
    console.error("[PATCH /api/certifications/[id]/ecard-code] Update error", updateError);
    return Response.json({ error: "Failed to save eCard code." }, { status: 500 });
  }

  return Response.json({ certNumber });
}
