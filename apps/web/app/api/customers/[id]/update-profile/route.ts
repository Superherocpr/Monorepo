/**
 * PATCH /api/customers/[id]/update-profile
 * Called by: CustomerDetailClient — per-field blur save on the profile edit section
 * Auth: Manager and super_admin only
 * Updates a single editable field on the customer's profile.
 * Allowed fields: first_name, last_name, email, phone, address, city, state, zip
 *
 * Email is a special case: updating it writes to BOTH profiles.email AND
 * auth.users.email (via the admin client). email_confirm: true skips the
 * Supabase confirmation flow so the change takes effect immediately — appropriate
 * for admin-initiated corrections.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";

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

  // ── Email: also update auth.users so the customer's login address changes ──
  // Uses the service-role admin client so no confirmation email is sent —
  // email_confirm: true marks the new address as verified immediately.
  if (field === "email" && cleanValue) {
    const adminClient = await createAdminClient();
    const { error: authError } = await adminClient.auth.admin.updateUserById(
      customerId,
      { email: cleanValue, email_confirm: true }
    );
    if (authError) {
      // The profiles row was already updated — roll it back to keep things in sync.
      await supabase
        .from("profiles")
        .update({ email: body.value, updated_at: new Date().toISOString() })
        .eq("id", customerId);
      return Response.json(
        { success: false, error: "Failed to update login email. Profile rolled back." },
        { status: 500 }
      );
    }
  }

  return Response.json({ success: true });
}
