/**
 * POST /api/auth/register
 * Called by: RequestClassWizard — "Create Account & Submit Request" flow
 * Auth: none — public self-registration endpoint
 * Creates a Supabase auth user (email pre-confirmed), inserts a customer
 * profile, and sends the branded welcome email via Resend. Uses the admin
 * client so RLS is bypassed and Supabase's own confirmation email is never
 * triggered — the client signs in with signInWithPassword() immediately after.
 *
 * Security notes:
 * - Duplicate email check prevents re-registration of existing accounts.
 * - Password is passed through to Supabase and never stored by this server.
 * - Role is hardcoded to "customer" — callers cannot self-assign any other role.
 * - Rate-limiting is handled at the Supabase auth layer.
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/server";
import { welcomeEmail } from "@/lib/emails";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Registers a new customer account.
 * @param request - POST body: { firstName, lastName, email, password, phone? }
 * @returns 200 { success: true } on success, or an error response.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { firstName, lastName, email, password, phone } = body as Record<string, unknown>;

  if (
    typeof firstName !== "string" || firstName.trim().length === 0 ||
    typeof lastName !== "string" || lastName.trim().length === 0 ||
    typeof email !== "string" || !EMAIL_REGEX.test(email) ||
    typeof password !== "string" || password.length < 8
  ) {
    return NextResponse.json(
      { success: false, error: "First name, last name, a valid email, and a password of at least 8 characters are required." },
      { status: 400 }
    );
  }

  const cleanPhone =
    typeof phone === "string" && phone.trim().length > 0 ? phone.trim() : null;

  const admin = await createAdminClient();

  // Duplicate email check — give a clear error rather than letting Supabase fail
  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { success: false, error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  // Create the auth user with email pre-confirmed so the client can sign in immediately
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: email.toLowerCase(),
    password,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    console.error("[auth/register] Auth user creation failed:", authError);
    return NextResponse.json(
      { success: false, error: "Failed to create account. Please try again." },
      { status: 500 }
    );
  }

  // Insert profile — admin client bypasses RLS
  const { error: profileError } = await admin.from("profiles").insert({
    id: authData.user.id,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    email: email.toLowerCase(),
    phone: cleanPhone,
    role: "customer",
  });

  if (profileError) {
    // Clean up the orphaned auth user so the email can be retried
    await admin.auth.admin.deleteUser(authData.user.id);
    console.error("[auth/register] Profile insert failed:", profileError);
    return NextResponse.json(
      { success: false, error: "Failed to save account details. Please try again." },
      { status: 500 }
    );
  }

  // Send the branded welcome email — best-effort, never blocks account creation
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, html } = welcomeEmail({ firstName: firstName.trim() });
    await resend.emails
      .send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: email.toLowerCase(),
        subject,
        html,
      })
      .catch((err: unknown) => {
        console.error("[auth/register] Welcome email failed:", err);
      });
  }

  return NextResponse.json({ success: true });
}
