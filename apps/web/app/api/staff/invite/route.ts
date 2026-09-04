/**
 * POST /api/staff/invite
 * Called by: Admin Staff Management — Invite Staff Member panel
 * Auth: super_admin only
 * Creates a Supabase auth user with email confirmation, inserts their profile,
 * generates a password setup link, and sends a welcome email.
 * Phone is required — instructors' numbers appear in customer booking emails.
 * Super Admin role is blocked here — staff must be promoted manually after creation.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireApiRole } from "@/lib/auth/effective-role";
import { OWNER_EMAILS } from "@/lib/constants";
import { sendEmail } from "@/lib/send-email";
import { staffInviteEmail } from "@/lib/emails";

/**
 * Creates a new staff account, sends a password setup email.
 * Rolls back the auth user if the profile insert fails.
 * @param request - POST body: { firstName, lastName, email, phone, role, personalMessage? }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // ── Auth & role check ──────────────────────────────────────────────────────
  const authResult = await requireApiRole(["super_admin"]);
  if ("error" in authResult) return authResult.error;
  const { actor } = authResult;
  const user = actor.user;

  // ── Parse and validate body ────────────────────────────────────────────────
  const body = await request.json();
  const { firstName, lastName, email, phone, role, personalMessage } = body as {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    role: string;
    personalMessage?: string;
  };

  // Phone is required for every account in this system, staff included. Staff
  // used to be created without one, which left instructors with a null phone —
  // and the booking confirmation email prints the instructor's number to the
  // customer, so those accounts were the source of "Call us at null".
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !phone?.trim() || !role) {
    return Response.json(
      { success: false, error: "Missing required fields." },
      { status: 400 }
    );
  }

  // Super Admin cannot be assigned via invite — must be promoted manually
  const allowedRoles = ["instructor", "manager", "inspector"];
  if (!allowedRoles.includes(role)) {
    return Response.json({ success: false, error: "Invalid role." }, { status: 400 });
  }

  // Owner emails are reserved — cannot be used for new accounts
  if (OWNER_EMAILS.includes(email.toLowerCase())) {
    return Response.json({ success: false, error: "This email is reserved." }, { status: 409 });
  }

  // ── Duplicate email check ──────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return Response.json(
      { success: false, error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  // ── Create auth user ───────────────────────────────────────────────────────
  const adminSupabase = await createAdminClient();

  // A random temp password is set — the user will replace it via the setup link
  const tempPassword = crypto.randomUUID();
  const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    console.error("[staff/invite] auth.admin.createUser failed:", authError);
    return Response.json(
      { success: false, error: "Failed to create account." },
      { status: 500 }
    );
  }

  // ── Insert profile ─────────────────────────────────────────────────────────
  const { error: profileError } = await adminSupabase.from("profiles").insert({
    id: authData.user.id,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    email,
    phone: phone.trim(),
    role,
  });

  if (profileError) {
    // Clean up the orphaned auth user so it cannot be re-used
    await adminSupabase.auth.admin.deleteUser(authData.user.id);
    console.error("[staff/invite] profile insert failed:", profileError);
    return Response.json(
      { success: false, error: "Failed to create profile." },
      { status: 500 }
    );
  }

  // ── Generate password setup link ───────────────────────────────────────────
  // We generate a recovery link and extract its hashed_token to build a direct
  // link to /setup-password. Sending action_link (the default Supabase URL)
  // would route through Supabase's redirect, which requires the redirect URL
  // to be in the Supabase Auth allowlist — a common misconfiguration point.
  // Using the hashed_token instead lets the email link go straight to our app.
  const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    // Account was created but link generation failed — return partial success
    console.error("[staff/invite] generateLink failed:", linkError);
    return Response.json({ success: true, emailSent: false });
  }

  // Build the link so it points directly at our /setup-password page.
  // The page exchanges the token via verifyOtp — no Supabase redirect needed.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com";
  const setupLink = `${baseUrl}/setup-password?token_hash=${linkData.properties.hashed_token}&type=recovery`;

  // ── Send invitation email ──────────────────────────────────────────────────
  const roleLabel =
    role === "instructor" ? "Instructor" : role === "manager" ? "Manager" : "Inspector";

  const { subject, html } = staffInviteEmail({
    firstName: firstName.trim(),
    personalMessage: personalMessage ?? null,
    roleLabel,
    actionLink: setupLink,
    isInstructor: role === "instructor",
  });

  // Account was created either way — a mail failure returns partial success so
  // the admin knows to use the Staff List "resend invite" action.
  const result = await sendEmail({
    context: "staff/invite",
    to: email,
    subject,
    html,
  });

  return Response.json({ success: true, emailSent: result.sent });
}
