/**
 * PATCH /api/customers/[id]/update-profile
 * Called by: CustomerDetailClient — per-field blur save on the profile edit section
 * Auth: Manager and super_admin only
 * Updates a single editable field on the customer's profile.
 * Allowed fields: first_name, last_name, email, phone, address, city, state, zip
 */

import { createClient } from "@/lib/supabase/server";

/** Allowed profile fields that staff can edit on behalf of a customer. */
const ALLOWED_FIELDS = new Set([
  "first_name",
  "last_name",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zip",
]);

/**
 * Updates a single profile field for the given customer ID.
 * @param request - PATCH request with JSON body: { field: string; value: string | null }
 * @param params - Route params containing the customer ID.
 */
export async function PATCH(
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
  let body: { field?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { field, value } = body;

  // Only explicitly allowed fields may be updated to prevent mass assignment.
  if (typeof field !== "string" || !ALLOWED_FIELDS.has(field)) {
    return Response.json({ success: false, error: "Invalid field." }, { status: 400 });
  }

  const cleanValue =
    typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;

  // Email requires a non-null value.
  if (field === "email" && !cleanValue) {
    return Response.json({ success: false, error: "Email cannot be empty." }, { status: 400 });
  }

  // ── Update profile ─────────────────────────────────────────────────────────
  const { error } = await supabase
    .from("profiles")
    .update({ [field]: cleanValue, updated_at: new Date().toISOString() })
    .eq("id", customerId)
    .eq("role", "customer"); // Safety: only update customer profiles

  if (error) {
    return Response.json({ success: false, error: "Update failed." }, { status: 500 });
  }

  return Response.json({ success: true });
}
