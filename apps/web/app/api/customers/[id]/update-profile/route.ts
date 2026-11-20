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

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";

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

/** Fields that may never be blank, with the name shown in the error message. */
const REQUIRED_FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone number",
};

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

  // ── Auth & role check ──────────────────────────────────────────────────────
  const authResult = await requireApiRole(["manager", "super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

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

  // These cannot be blank. Phone is required site-wide, and the database also
  // refuses a null phone, so rejecting here turns a bare 500 into a clear message.
  const requiredLabel = REQUIRED_FIELD_LABELS[field];
  if (requiredLabel && !cleanValue) {
    return Response.json(
      { success: false, error: `${requiredLabel} is required.` },
      { status: 400 }
    );
  }

  // The rollback below needs the address as it is now, so read it before writing.
  let previousEmail: string | null = null;
  if (field === "email") {
    const { data: current } = await adminClient
      .from("profiles")
      .select("email")
      .eq("id", customerId)
      .eq("role", "customer")
      .maybeSingle();
    previousEmail = current?.email ?? null;
  }

  // ── Update profile ─────────────────────────────────────────────────────────
  const { error } = await adminClient
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
    const { error: authError } = await adminClient.auth.admin.updateUserById(
      customerId,
      { email: cleanValue, email_confirm: true }
    );
    if (authError) {
      // The profiles row was already updated: put the previous address back so
      // the profile and the login email stay in sync.
      if (previousEmail) {
        await adminClient
          .from("profiles")
          .update({ email: previousEmail, updated_at: new Date().toISOString() })
          .eq("id", customerId);
      }
      return Response.json(
        {
          success: false,
          error: "That email could not be used for login. It may already belong to another account. Nothing was changed.",
        },
        { status: 409 }
      );
    }
  }

  return Response.json({ success: true });
}
