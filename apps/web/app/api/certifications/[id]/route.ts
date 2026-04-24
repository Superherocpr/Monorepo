/**
 * PATCH /api/certifications/[id]
 * Called by: CertificationsClient — edit cert slide-in panel
 * Auth: super_admin only
 * Updates editable fields on an existing certification record.
 *
 * DELETE /api/certifications/[id]
 * Called by: CertificationsClient — inline delete confirmation
 * Auth: super_admin only
 * Deletes the certification record. No business-logic guard — any cert can be deleted.
 */

import { createClient } from "@/lib/supabase/server";

/** Validates that a route param is a plausible UUID. */
function isValidUuid(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

/**
 * Shared auth helper — validates user session and enforces super_admin role.
 * @param supabase - Server-side Supabase client
 * Returns the user's profile, or a Response error if unauthorized.
 */
async function requireSuperAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "super_admin") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { error: null };
}

/**
 * Updates an existing certification's editable fields.
 * Body: { certTypeId?, issuedAt?, expiresAt?, certNumber?, notes?, reminderSent? }
 * @param request - Incoming PATCH request with JSON body
 * @param params - Route params containing { id }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const auth = await requireSuperAdmin(supabase);
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return Response.json({ error: "Invalid certification ID." }, { status: 400 });
  }

  let body: {
    certTypeId?: string;
    issuedAt?: string;
    expiresAt?: string;
    certNumber?: string | null;
    notes?: string | null;
    reminderSent?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Build the update payload from only the fields provided
  const update: Record<string, unknown> = {};
  if (body.certTypeId !== undefined) update.cert_type_id = body.certTypeId;
  if (body.issuedAt !== undefined) update.issued_at = body.issuedAt;
  if (body.expiresAt !== undefined) update.expires_at = body.expiresAt;
  if (body.certNumber !== undefined) update.cert_number = body.certNumber;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.reminderSent !== undefined) update.reminder_sent = body.reminderSent;

  if (Object.keys(update).length === 0) {
    return Response.json({ error: "No fields to update." }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("certifications")
    .update(update)
    .eq("id", id);

  if (updateError) {
    console.error("[PATCH /api/certifications/[id]] Update error", updateError);
    return Response.json({ error: "Failed to update certification." }, { status: 500 });
  }

  // Fetch the full updated record to return to the client
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
    .eq("id", id)
    .single();

  if (fetchError || !cert) {
    return Response.json({ error: "Certification updated but could not be retrieved." }, { status: 500 });
  }

  return Response.json({ cert });
}

/**
 * Deletes a certification record.
 * @param _request - Incoming DELETE request (body not required)
 * @param params - Route params containing { id }
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const auth = await requireSuperAdmin(supabase);
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return Response.json({ error: "Invalid certification ID." }, { status: 400 });
  }

  const { error } = await supabase
    .from("certifications")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[DELETE /api/certifications/[id]] Delete error", error);
    return Response.json({ error: "Failed to delete certification." }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
