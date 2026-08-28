/**
 * PATCH /api/staff/[id]/update
 * Called by: Admin Staff Management — Edit Contact inline form
 * Auth: super_admin only
 * Updates first name, last name, email, and/or phone on a staff member's profile.
 * Email is written to BOTH profiles.email AND auth.users.email so the login
 * address stays in sync. email_confirm: true applies the change immediately
 * without sending a confirmation email — appropriate for admin-initiated corrections.
 * Owner protection: owner emails cannot be targeted.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { OWNER_EMAILS } from "@/lib/constants";

/**
 * Updates a staff member's first name, last name, email, and/or phone.
 * @param request - PATCH body: { first_name?: string; last_name?: string; email?: string; phone?: string }
 * @param params - Route params containing the target staff member's profile ID.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetId } = await params;

  // ── Auth & role check ──────────────────────────────────────────────────────
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;

  const adminClient = await createAdminClient();

  // ── Owner protection ───────────────────────────────────────────────────────
  const { data: target } = await adminClient
    .from("profiles")
    .select("email, role")
    .eq("id", targetId)
    .single();

  if (!target) {
    return Response.json(
      { success: false, error: "Staff member not found." },
      { status: 404 }
    );
  }

  if (OWNER_EMAILS.includes(target.email.toLowerCase())) {
    return Response.json(
      { success: false, error: "The owner's contact details cannot be changed here." },
      { status: 403 }
    );
  }

  // Ensure we're only targeting staff (not a customer profile)
  const staffRoles = ["instructor", "manager", "super_admin", "inspector"];
  if (!staffRoles.includes(target.role)) {
    return Response.json(
      { success: false, error: "Target is not a staff member." },
      { status: 400 }
    );
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { first_name?: unknown; last_name?: unknown; email?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const firstNameValue =
    typeof body.first_name === "string" && body.first_name.trim().length > 0
      ? body.first_name.trim()
      : null;

  const lastNameValue =
    typeof body.last_name === "string" && body.last_name.trim().length > 0
      ? body.last_name.trim()
      : null;

  const emailValue =
    typeof body.email === "string" && body.email.trim().length > 0
      ? body.email.trim().toLowerCase()
      : null;

  const phoneValue =
    typeof body.phone === "string" && body.phone.trim().length > 0
      ? body.phone.trim()
      : null;

  // At least one field must be present in the request
  if (
    body.first_name === undefined &&
    body.last_name === undefined &&
    body.email === undefined &&
    body.phone === undefined
  ) {
    return Response.json(
      { success: false, error: "No fields to update." },
      { status: 400 }
    );
  }

  if (body.first_name !== undefined && !firstNameValue) {
    return Response.json(
      { success: false, error: "First name cannot be empty." },
      { status: 400 }
    );
  }

  if (body.last_name !== undefined && !lastNameValue) {
    return Response.json(
      { success: false, error: "Last name cannot be empty." },
      { status: 400 }
    );
  }

  if (body.phone !== undefined && !phoneValue) {
    return Response.json(
      { success: false, error: "Phone number cannot be empty." },
      { status: 400 }
    );
  }

  // ── Build profile update payload ───────────────────────────────────────────
  const profileUpdate: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  if (body.first_name !== undefined) profileUpdate.first_name = firstNameValue;
  if (body.last_name !== undefined) profileUpdate.last_name = lastNameValue;
  if (body.email !== undefined) profileUpdate.email = emailValue;
  if (body.phone !== undefined) profileUpdate.phone = phoneValue;

  const { error: profileError } = await adminClient
    .from("profiles")
    .update(profileUpdate)
    .eq("id", targetId);

  if (profileError) {
    return Response.json(
      { success: false, error: "Failed to update profile." },
      { status: 500 }
    );
  }

  // ── Email: also update auth.users so the login address changes ──────────
  // Uses the service-role admin client. email_confirm: true skips confirmation
  // so the change is immediate — appropriate for admin-initiated corrections.
  if (emailValue && body.email !== undefined) {
    const { error: authError } = await adminClient.auth.admin.updateUserById(
      targetId,
      { email: emailValue, email_confirm: true }
    );

    if (authError) {
      // Roll back the profiles update to keep both tables in sync
      await adminClient
        .from("profiles")
        .update({ email: target.email, updated_at: new Date().toISOString() })
        .eq("id", targetId);
      return Response.json(
        { success: false, error: "Failed to update login email. Profile rolled back." },
        { status: 500 }
      );
    }
  }

  return Response.json({ success: true });
}
