/**
 * PATCH /api/profile/self-update
 * Called by: AccountSettingsSection — the Account tab on /admin/settings.
 * Auth: any staff role, acting ONLY on their own account (actor.user.id).
 *
 * Self-service equivalent of PATCH /api/staff/[id]/update, which is super-admin
 * only and targets someone else. Updates first name, last name, phone, login
 * email, and password for the calling user.
 *
 * Email is written to BOTH profiles.email AND auth.users.email so the login
 * address and the contact address stay identical — the site treats them as one
 * value, and /book plus every confirmation email read profiles.email/phone live,
 * so a change here surfaces everywhere on the next read.
 *
 * Security notes:
 * - Changing email or password requires the CURRENT password. A live session
 *   cookie alone is not sufficient: a hijacked session could otherwise change
 *   both the login address and password and lock the real owner out.
 * - The password check runs against the account's stored email, never a
 *   client-supplied one, and must resolve to the caller's own user id.
 * - Owner accounts (OWNER_EMAILS) cannot change their email here — owner status
 *   is matched by email string, so a self-service change would silently strip
 *   the owner's protection against deactivation, deletion, and role changes.
 * - email_confirm: true applies the new address immediately. The caller has
 *   already proven ownership with their password, and a pending-confirmation
 *   state would leave profiles.email and auth.users.email disagreeing.
 * - Duplicate-email check runs before any write so the two tables cannot diverge.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { requireApiRole, STAFF_ROLES } from "@/lib/auth/effective-role";
import { verifyPassword } from "@/lib/auth/verify-password";
import { OWNER_EMAILS } from "@/lib/constants";

/** Minimal email shape check — deliverability is proven by the address working, not by a regex. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Minimum length for a new password, matching every other password gate in the app. */
const MIN_PASSWORD_LENGTH = 8;

interface SelfUpdateBody {
  first_name?: unknown;
  last_name?: unknown;
  phone?: unknown;
  email?: unknown;
  current_password?: unknown;
  new_password?: unknown;
}

/**
 * Updates the calling staff member's own name, phone, email, and/or password.
 * Side effects: updates the profiles row; may update auth.users (email/password).
 * @param request - PATCH body: { first_name?, last_name?, phone?, email?,
 *   current_password?, new_password? }
 * @returns 200 { success: true } on success, or an error response.
 */
export async function PATCH(request: Request): Promise<Response> {
  const authResult = await requireApiRole(STAFF_ROLES);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;
  const userId = actor.user.id;

  let body: SelfUpdateBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const admin = await createAdminClient();

  // Current stored values — the email here is the identity used for the password
  // check, so it must come from the DB and never from the request body.
  const { data: current } = await admin
    .from("profiles")
    .select("email, phone, first_name, last_name")
    .eq("id", userId)
    .single();

  if (!current) {
    return Response.json({ success: false, error: "Profile not found." }, { status: 404 });
  }

  // ── Normalize inputs ───────────────────────────────────────────────────────
  const firstName =
    typeof body.first_name === "string" ? body.first_name.trim() : null;
  const lastName =
    typeof body.last_name === "string" ? body.last_name.trim() : null;
  const phone = typeof body.phone === "string" ? body.phone.trim() : null;
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
  const currentPassword =
    typeof body.current_password === "string" ? body.current_password : "";
  const newPassword =
    typeof body.new_password === "string" && body.new_password.length > 0
      ? body.new_password
      : null;

  if (body.first_name !== undefined && !firstName) {
    return Response.json(
      { success: false, error: "First name cannot be empty." },
      { status: 400 }
    );
  }

  if (body.last_name !== undefined && !lastName) {
    return Response.json(
      { success: false, error: "Last name cannot be empty." },
      { status: 400 }
    );
  }

  // Phone is required site-wide — it may be changed but never blanked.
  if (body.phone !== undefined && !phone) {
    return Response.json(
      { success: false, error: "Phone number is required." },
      { status: 400 }
    );
  }

  if (body.email !== undefined && (!email || !EMAIL_REGEX.test(email))) {
    return Response.json(
      { success: false, error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  if (newPassword && newPassword.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const emailChanged = email !== null && email !== current.email.toLowerCase();
  const isOwner = OWNER_EMAILS.includes(current.email.toLowerCase());

  // Owner status is keyed on the email string, so letting the owner change their
  // own address here would quietly remove their protection everywhere it is
  // checked. Requires an OWNER_EMAIL env change first, which is a deploy action.
  if (emailChanged && isOwner) {
    return Response.json(
      {
        success: false,
        error:
          "The owner account's email is tied to system configuration and cannot be changed here. Contact your developer to update it.",
      },
      { status: 403 }
    );
  }

  // ── Sensitive-change gate ──────────────────────────────────────────────────
  const needsPassword = emailChanged || newPassword !== null;

  if (needsPassword) {
    if (!currentPassword) {
      return Response.json(
        {
          success: false,
          error: "Enter your current password to change your email or password.",
        },
        { status: 400 }
      );
    }

    const verified = await verifyPassword(
      current.email,
      currentPassword,
      userId,
      "profile/self-update"
    );

    if (!verified.ok) {
      if (verified.reason === "config") {
        return Response.json(
          { success: false, error: "Server configuration error. Please contact support." },
          { status: 500 }
        );
      }
      return Response.json(
        { success: false, error: "Current password is incorrect." },
        { status: 401 }
      );
    }
  }

  // ── Duplicate email check — before any write ───────────────────────────────
  if (emailChanged) {
    const { data: taken } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .neq("id", userId)
      .maybeSingle();

    if (taken) {
      return Response.json(
        { success: false, error: "That email address is already in use." },
        { status: 409 }
      );
    }
  }

  // ── Profile write ──────────────────────────────────────────────────────────
  const profileUpdate: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };
  if (firstName) profileUpdate.first_name = firstName;
  if (lastName) profileUpdate.last_name = lastName;
  if (phone) profileUpdate.phone = phone;
  if (emailChanged && email) profileUpdate.email = email;

  const { error: profileError } = await admin
    .from("profiles")
    .update(profileUpdate)
    .eq("id", userId);

  if (profileError) {
    console.error("[profile/self-update] Profile update failed:", profileError.message);
    return Response.json(
      { success: false, error: "Failed to save your details. Please try again." },
      { status: 500 }
    );
  }

  // ── Auth write: email ──────────────────────────────────────────────────────
  // Rolled back on failure so profiles.email can never drift from auth.users.email.
  if (emailChanged && email) {
    const { error: authEmailError } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });

    if (authEmailError) {
      await admin
        .from("profiles")
        .update({ email: current.email, updated_at: new Date().toISOString() })
        .eq("id", userId);

      console.error("[profile/self-update] Auth email update failed:", authEmailError.message);
      return Response.json(
        {
          success: false,
          error: "Failed to update your login email. No changes to your email were saved.",
        },
        { status: 500 }
      );
    }
  }

  // ── Auth write: password ───────────────────────────────────────────────────
  // Last, so an email rollback above never leaves a changed password behind.
  if (newPassword) {
    const { error: passwordError } = await admin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (passwordError) {
      console.error("[profile/self-update] Password update failed:", passwordError.message);
      return Response.json(
        {
          success: false,
          error:
            "Your details were saved, but the password change failed. Please try changing it again.",
        },
        { status: 500 }
      );
    }
  }

  return Response.json({ success: true, emailChanged });
}
