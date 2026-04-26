/**
 * POST /api/staff/invite
 * Called by: Admin Staff Management — Invite Staff Member panel
 * Auth: super_admin only
 * Creates a Supabase auth user with email confirmation, inserts their profile,
 * generates a password setup link, and sends a welcome email via Resend.
 * Super Admin role is blocked here — staff must be promoted manually after creation.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { OWNER_EMAIL } from "@/lib/constants";
import { Resend } from "resend";
import { staffInviteEmail } from "@/lib/emails";

/**
 * Creates a new staff account, sends a password setup email.
 * Rolls back the auth user if the profile insert fails.
 * @param request - POST body: { firstName, lastName, email, role, personalMessage? }
 */
export async function POST(request: Request) {
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

  if (!actor || actor.role !== "super_admin") {
    return Response.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  // ── Parse and validate body ────────────────────────────────────────────────
  const body = await request.json();
  const { firstName, lastName, email, role, personalMessage } = body as {
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    personalMessage?: string;
  };

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !role) {
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

  // Owner email is reserved — cannot be used for a new account
  if (email.toLowerCase() === OWNER_EMAIL.toLowerCase()) {
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
  const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (linkError || !linkData?.properties?.action_link) {
    // Account was created but link generation failed — return partial success
    console.error("[staff/invite] generateLink failed:", linkError);
    return Response.json({ success: true, emailSent: false });
  }

  // ── Send invitation email ──────────────────────────────────────────────────
  const resend = new Resend(process.env.RESEND_API_KEY);
  const roleLabel =
    role === "instructor" ? "Instructor" : role === "manager" ? "Manager" : "Inspector";

  const { subject, html } = staffInviteEmail({
    firstName: firstName.trim(),
    personalMessage: personalMessage ?? null,
    roleLabel,
    actionLink: linkData.properties.action_link,
    isInstructor: role === "instructor",
  });

  await resend.emails.send({
    from: "SuperHeroCPR <noreply@superherocpr.com>",
    to: email,
    subject,
    html,
  });

  return Response.json({ success: true });
}
