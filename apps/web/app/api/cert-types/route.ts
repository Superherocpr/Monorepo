/**
 * POST /api/cert-types
 * Called by: CertificationsClient — "Add Cert Type" slide-in panel
 * Auth: super_admin only
 * Creates a new cert type record.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Creates a new certification type.
 * Body: { name, description?, validityMonths, issuingBody?, active }
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

  const { name, description, validityMonths, issuingBody, active } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "name is required." }, { status: 400 });
  }
  if (!validityMonths || typeof validityMonths !== "number" || validityMonths < 1) {
    return Response.json(
      { error: "validityMonths must be a positive integer." },
      { status: 400 }
    );
  }

  // ── Insert ─────────────────────────────────────────────────────────────────
  const { data: certType, error } = await supabase
    .from("cert_types")
    .insert({
      name: name.trim(),
      description: description ?? null,
      validity_months: validityMonths,
      issuing_body: issuingBody ?? null,
      active: active ?? true,
    })
    .select("id, name, description, validity_months, issuing_body, active")
    .single();

  if (error || !certType) {
    console.error("[POST /api/cert-types] Insert error", error);
    // Unique constraint on name
    if (error?.code === "23505") {
      return Response.json(
        { error: "A cert type with that name already exists." },
        { status: 409 }
      );
    }
    return Response.json({ error: "Failed to create cert type." }, { status: 500 });
  }

  return Response.json({ certType }, { status: 201 });
}
