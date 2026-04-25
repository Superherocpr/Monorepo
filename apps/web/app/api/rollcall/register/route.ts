/**
 * POST /api/rollcall/register
 * Called by: /rollcall page — Step 4b (new student account creation)
 * Auth: None — the student is creating their account here
 * Creates a Supabase auth user + profile, adds them to the class roster,
 * and sends a welcome email via Resend. Does NOT create a booking record.
 */

import { Resend } from "resend";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * Creates a new student account and roster_record.
 * Welcome email is sent after successful registration.
 * @param request - POST body: { firstName, lastName, email, phone?, password, sessionId }
 */
export async function POST(request: Request) {
  // Use the anonymous client for auth.signUp — it needs anon key
  const supabase = await createClient();
  // Use admin client for profile insert to bypass RLS on new accounts
  const adminSupabase = await createAdminClient();

  const body = await request.json();
  const { firstName, lastName, email, phone, password, sessionId } = body as {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    password: string;
    sessionId: string;
  };

  // ── Input validation ──────────────────────────────────────────────────────
  if (!firstName || !lastName || !email || !password || !sessionId) {
    return Response.json(
      { success: false, error: "All required fields must be provided." },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return Response.json(
      { success: false, error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return Response.json({ success: false, error: "Invalid email format." }, { status: 400 });
  }

  // ── 1. Create Supabase auth user ─────────────────────────────────────────
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: email.toLowerCase(),
    password,
  });

  if (authError || !authData.user) {
    // Email already registered — send them to sign-in instead
    const message =
      authError?.message?.includes("already registered")
        ? "An account with this email already exists. Please go back and sign in."
        : "Failed to create account. Please try again.";
    return Response.json({ success: false, error: message }, { status: 400 });
  }

  const userId = authData.user.id;

  // ── 2. Insert profile ────────────────────────────────────────────────────
  const { error: profileError } = await adminSupabase.from("profiles").insert({
    id: userId,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    email: email.toLowerCase(),
    phone: phone?.trim() || null,
    role: "customer",
  });

  if (profileError) {
    return Response.json(
      { success: false, error: "Failed to create profile." },
      { status: 500 }
    );
  }

  // ── 3. Create roster_record ──────────────────────────────────────────────
  // booking_id is null — group invoice bookings may not have a customer_id
  // linked yet (see schema note on group invoice booking creation).
  // The instructor can reconcile during grading if needed.
  const { error: rosterError } = await adminSupabase.from("roster_records").insert({
    session_id: sessionId,
    booking_id: null,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    email: email.toLowerCase(),
    phone: phone?.trim() || null,
  });

  if (rosterError) {
    return Response.json(
      { success: false, error: "Account created but failed to add to roster." },
      { status: 500 }
    );
  }

  // ── 4. Send welcome email ────────────────────────────────────────────────
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "SuperHeroCPR <noreply@superherocpr.com>",
      to: email.toLowerCase(),
      subject: "Welcome to SuperHeroCPR!",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h1 style="color: #dc2626;">Welcome, ${firstName}!</h1>
          <p>You've been checked in for today's class. Great to have you!</p>
          <p>Your SuperHeroCPR account is now active. You can view your certifications
          and booking history at
          <a href="https://superherocpr.com/dashboard">superherocpr.com/dashboard</a>.</p>
          <p>— The SuperHeroCPR Team</p>
        </div>
      `,
    });
  } catch {
    // Welcome email failure is non-fatal — student is still checked in
    // The account and roster_record are already committed
    console.error("[rollcall/register] Failed to send welcome email to", email);
  }

  return Response.json({ success: true });
}
