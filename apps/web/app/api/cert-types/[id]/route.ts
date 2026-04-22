/**
 * PATCH /api/cert-types/[id]
 * Called by: CertificationsClient — edit cert type panel and deactivate/activate toggle
 * Auth: super_admin only
 * Updates a cert type's fields. Partial updates are supported — only provided
 * fields are changed. Cert types are never deleted; use active=false to deactivate.
 */

import { createClient } from "@/lib/supabase/server";

/** Validates that a value is a plausible UUID. */
function isValidUuid(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

/**
 * Updates a cert type's editable fields.
 * Body (all optional): { name?, description?, validityMonths?, issuingBody?, active? }
 * @param request - Incoming PATCH request with JSON body
 * @param params - Route params containing { id }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  if (!isValidUuid(id)) {
    return Response.json({ error: "Invalid cert type ID." }, { status: 400 });
  }

  let body: {
    name?: string;
    description?: string | null;
    validityMonths?: number;
    issuingBody?: string | null;
    active?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Build update payload from provided fields only
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name.trim();
  if (body.description !== undefined) update.description = body.description;
  if (body.validityMonths !== undefined) update.validity_months = body.validityMonths;
  if (body.issuingBody !== undefined) update.issuing_body = body.issuingBody;
  if (body.active !== undefined) update.active = body.active;

  if (Object.keys(update).length === 0) {
    return Response.json({ error: "No fields to update." }, { status: 400 });
  }

  const { data: certType, error } = await supabase
    .from("cert_types")
    .update(update)
    .eq("id", id)
    .select("id, name, description, validity_months, issuing_body, active")
    .single();

  if (error || !certType) {
    console.error("[PATCH /api/cert-types/[id]] Update error", error);
    if (error?.code === "23505") {
      return Response.json(
        { error: "A cert type with that name already exists." },
        { status: 409 }
      );
    }
    return Response.json({ error: "Failed to update cert type." }, { status: 500 });
  }

  return Response.json({ certType });
}
