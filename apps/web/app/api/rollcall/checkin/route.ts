/**
 * POST /api/rollcall/checkin
 * Called by: /rollcall page — Step 4a (returning student sign-in)
 * Auth: None required — Supabase sign-in IS the verification
 * Signs the student in via password, then creates a roster_record for the
 * session. The student MUST have an existing (non-cancelled) booking for the
 * session — unpaid walk-ups are rejected (THREAT-007). If already checked in,
 * the call is a no-op that confirms gracefully.
 * Does NOT create a booking record — student already has one.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Signs in a returning student and creates their roster_record.
 * @param request - POST body: { email: string, password: string, sessionId: string }
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const body = await request.json();
  const { email, password, sessionId } = body as {
    email: string;
    password: string;
    sessionId: string;
  };

  if (!email || !password || !sessionId) {
    return Response.json(
      { success: false, error: "email, password, and sessionId required" },
      { status: 400 }
    );
  }

  // ── 1. Authenticate the student ──────────────────────────────────────────
  const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase(),
    password,
  });

  if (signInError || !authData.user) {
    return Response.json({ success: false, error: "Incorrect password." }, { status: 401 });
  }

  const userId = authData.user.id;

  // ── 2. Check if already checked in ──────────────────────────────────────
  const { data: existingRecord } = await supabase
    .from("roster_records")
    .select("id")
    .eq("session_id", sessionId)
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (existingRecord) {
    // Already on roster — confirm gracefully without blocking
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name")
      .eq("id", userId)
      .single();

    return Response.json({
      success: true,
      alreadyCheckedIn: true,
      firstName: profile?.first_name ?? null,
    });
  }

  // ── 3. Require an existing booking for this session (THREAT-007) ─────────
  // A non-cancelled booking proves the student paid (online, invoice, or was
  // added by an instructor). Without one, refuse the check-in — the instructor
  // can add them via the admin tools after collecting payment.
  const { data: booking } = await supabase
    .from("bookings")
    .select("id")
    .eq("session_id", sessionId)
    .eq("customer_id", userId)
    .eq("cancelled", false)
    .maybeSingle();

  if (!booking) {
    return Response.json(
      {
        success: false,
        error:
          "No booking found for you in this class. Please pay first or see your instructor.",
      },
      { status: 403 }
    );
  }

  // ── 4. Fetch profile details for roster record ───────────────────────────
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, phone")
    .eq("id", userId)
    .single();

  if (!profile) {
    return Response.json(
      { success: false, error: "Profile not found." },
      { status: 500 }
    );
  }

  // ── 5. Create roster_record ──────────────────────────────────────────────
  const { error: insertError } = await supabase.from("roster_records").insert({
    session_id: sessionId,
    booking_id: booking.id,
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: email.toLowerCase(),
    phone: profile.phone ?? null,
  });

  if (insertError) {
    return Response.json(
      { success: false, error: "Failed to create roster record." },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    alreadyCheckedIn: false,
    firstName: profile.first_name,
  });
}
