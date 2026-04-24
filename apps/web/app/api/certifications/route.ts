/**
 * POST /api/certifications
 * Called by: CertificationsClient — "Issue Certification" slide-in panel
 * Auth: super_admin only
 * Creates a new certification record manually (session_id = null).
 * Returns the new cert with joined profiles, cert_types, and class_sessions.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Creates a new manually-issued certification.
 * Body: { customerId, certTypeId, issuedAt, expiresAt, certNumber?, notes? }
 * @param request - Incoming POST request with JSON body
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "super_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Parse and validate body ────────────────────────────────────────────────
  let body: {
    customerId?: string;
    certTypeId?: string;
    issuedAt?: string;
    expiresAt?: string;
    certNumber?: string | null;
    notes?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { customerId, certTypeId, issuedAt, expiresAt, certNumber, notes } = body;

  if (!customerId || !certTypeId || !issuedAt || !expiresAt) {
    return Response.json(
      { error: "customerId, certTypeId, issuedAt, and expiresAt are required." },
      { status: 400 }
    );
  }

  // ── Verify the customer exists and is not archived ─────────────────────────
  const { data: customer } = await supabase
    .from("profiles")
    .select("id, archived")
    .eq("id", customerId)
    .single();

  if (!customer) {
    return Response.json({ error: "Customer not found." }, { status: 404 });
  }
  if (customer.archived) {
    return Response.json(
      { error: "Cannot issue a certification to an archived customer." },
      { status: 409 }
    );
  }

  // ── Insert the certification ───────────────────────────────────────────────
  const { data: inserted, error: insertError } = await supabase
    .from("certifications")
    .insert({
      customer_id: customerId,
      cert_type_id: certTypeId,
      session_id: null,
      issued_at: issuedAt,
      expires_at: expiresAt,
      cert_number: certNumber ?? null,
      notes: notes ?? null,
      reminder_sent: false,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("[POST /api/certifications] Insert error", insertError);
    return Response.json({ error: "Failed to create certification." }, { status: 500 });
  }

  // ── Fetch the full record with joins to return to the client ───────────────
  const { data: cert, error: fetchError } = await supabase
    .from("certifications")
    .select(`
      id, issued_at, expires_at, cert_number, notes, reminder_sent, session_id,
      profiles!customer_id ( id, first_name, last_name, email ),
      cert_types ( id, name, issuing_body, validity_months ),
      class_sessions (
        starts_at,
        class_types ( name )
      )
    `)
    .eq("id", inserted.id)
    .single();

  if (fetchError || !cert) {
    console.error("[POST /api/certifications] Fetch-after-insert error", fetchError);
    return Response.json({ error: "Certification created but could not be retrieved." }, { status: 500 });
  }

  return Response.json({ cert }, { status: 201 });
}
