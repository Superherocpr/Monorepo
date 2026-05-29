/**
 * POST /api/rollcall/recruit
 * Called by: /recruit page — Step 3 (self-registration form)
 * Auth: None — sessionId is a non-guessable UUID obtained only after providing
 *       a valid 6-digit instructor access code in the prior step.
 * Creates a Supabase Auth account, a profile, a booking (via the atomic
 * book_spot RPC), and a confirmed roster_record for a new student registering
 * on class day for a bulk-paid session where the exact head count was not
 * known in advance.
 *
 * If the email is already registered, the caller is directed to /rollcall
 * instead. If the class is full, a 409 is returned. Auth user creation is
 * rolled back if any subsequent step fails.
 */

import { createAdminClient } from "@/lib/supabase/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Registers a new student for a session identified by the rollcall code flow.
 * @param request - POST body: { sessionId, firstName, lastName, email, phone?, password }
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { sessionId, firstName, lastName, email, phone, password } = body as {
    sessionId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    password: string;
  };

  // ── Input validation ───────────────────────────────────────────────────────
  if (!sessionId || !firstName?.trim() || !lastName?.trim() || !email?.trim() || !password) {
    return Response.json({ error: "All required fields must be filled in." }, { status: 400 });
  }

  if (!EMAIL_PATTERN.test(email.trim())) {
    return Response.json({ error: "Invalid email address." }, { status: 400 });
  }

  if (password.length < 8) {
    return Response.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const supabase = await createAdminClient();
  const normalizedEmail = email.trim().toLowerCase();

  // ── 1. Verify session is valid and available ────────────────────────────────
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id, approval_status, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (
    !session ||
    session.approval_status !== "approved" ||
    session.status === "cancelled"
  ) {
    return Response.json(
      { error: "This class is not available for registration." },
      { status: 400 }
    );
  }

  // ── 2. Check if email is already in use ────────────────────────────────────
  // profiles.email has a UNIQUE constraint — a match means an account exists.
  // Direct those students to /rollcall where they can check in normally.
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existingProfile) {
    return Response.json(
      {
        error:
          "An account with this email already exists. If you are enrolled in this class, please use the Roll Call page instead.",
      },
      { status: 409 }
    );
  }

  // ── 3. Create Supabase Auth user ────────────────────────────────────────────
  // email_confirm: true skips the verification email — the student is physically
  // present in class and verified by the instructor's access code.
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    console.error("[recruit] Auth user creation error:", authError?.message);
    return Response.json(
      { error: "Failed to create account. Please try again." },
      { status: 500 }
    );
  }

  const userId = authData.user.id;

  // All steps below run inside a try/catch so the auth user is deleted if
  // anything fails — prevents orphaned auth accounts with no profile.
  try {
    // ── 4. Create profile ────────────────────────────────────────────────────
    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: normalizedEmail,
      phone: phone?.trim() || null,
      // Explicitly set role — the DB default is 'customer' but Supabase inserts
      // can bypass column defaults when the column is NOT NULL without a trigger.
      role: "customer",
    });

    if (profileError) {
      throw new Error(`profile: ${profileError.message}`);
    }

    // ── 5. Create booking via atomic RPC ─────────────────────────────────────
    // book_spot locks the session row and checks capacity before inserting,
    // preventing overbooking under concurrent registration traffic.
    const { data: bookingId, error: bookingError } = await supabase.rpc("book_spot", {
      p_session_id: sessionId,
      p_customer_id: userId,
      p_booking_source: "rollcall",
    });

    if (bookingError) {
      if (bookingError.message?.includes("session_full")) {
        throw new Error("session_full");
      }
      throw new Error(`booking: ${bookingError.message}`);
    }

    // ── 6. Create confirmed roster record ────────────────────────────────────
    const { error: rosterError } = await supabase.from("roster_records").insert({
      session_id: sessionId,
      booking_id: bookingId as string,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: normalizedEmail,
      phone: phone?.trim() || null,
      // confirmed=true because the student is physically present and self-registering
      confirmed: true,
      corrected: false,
    });

    if (rosterError) {
      throw new Error(`roster: ${rosterError.message}`);
    }

    return Response.json({ success: true, firstName: firstName.trim() });
  } catch (err) {
    // Roll back the auth user to prevent orphaned accounts
    await supabase.auth.admin.deleteUser(userId);

    const message = err instanceof Error ? err.message : "";

    if (message === "session_full") {
      return Response.json(
        { error: "This class is full. Please see your instructor." },
        { status: 409 }
      );
    }

    console.error("[recruit] Registration rollback after error:", message);
    return Response.json(
      { error: "Registration failed. Please try again." },
      { status: 500 }
    );
  }
}
